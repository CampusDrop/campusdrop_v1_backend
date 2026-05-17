const crypto = require('crypto');
const express = require('express');
const { Prisma } = require('@prisma/client');
const { prisma } = require('../lib/prisma');
const { requireFestivalPhone } = require('../lib/requireFestivalPhone');
const { normalizeKoMobile } = require('../lib/festivalPhone');
const {
  resolveSlotHoursFromConfig,
  slotUtcStarts,
  todayKstYmd,
  resolveSlotForSubmission,
  applicationVisibleAfterSlotPass,
  ymdFromPrismaDateOnly,
  dateOnlyFromYmd,
} = require('../lib/festivalSlotPolicy');

const router = express.Router();

/** @param {unknown} body */
function parseMoodApplyBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: /** @type {const} */ (false), error: '요청 본문은 JSON 객체여야 합니다.' };
  }
  /** @type {Record<string, unknown>} */
  const b = /** @type {Record<string, unknown>} */ (body);
  const peopleCount = Number(b.peopleCount ?? b.people_count);
  if (!Number.isInteger(peopleCount) || peopleCount < 1 || peopleCount > 20) {
    return {
      ok: /** @type {const} */ (false),
      error: 'peopleCount는 1 이상 정수여야 합니다.',
    };
  }
  const vibe = typeof b.vibe === 'string' ? b.vibe.trim().slice(0, 20) : '';
  if (!vibe) {
    return { ok: /** @type {const} */ (false), error: 'vibe 값이 필요합니다.' };
  }

  let genderGuess = '';
  const genderRaw = typeof b.gender === 'string' ? b.gender.trim().toUpperCase() : '';
  if (genderRaw === 'M' || genderRaw === 'F') {
    genderGuess = genderRaw;
  } else if (genderRaw === 'MALE') {
    genderGuess = 'M';
  } else if (genderRaw === 'FEMALE') {
    genderGuess = 'F';
  } else if (genderRaw !== '') {
    if (/^(M|남|MALE|MEN|MAN)/i.test(String(b.gender))) genderGuess = 'M';
    else if (/^(F|여|FEMALE|WOMAN)/i.test(String(b.gender))) genderGuess = 'F';
  }

  const phoneNormalized = normalizeKoMobile(b.phone);
  if (!(phoneNormalized.length === 11 && phoneNormalized.startsWith('01'))) {
    return {
      ok: /** @type {const} */ (false),
      error: '휴대폰 번호(010 포함 11자리) 형식으로 입력해 주세요.',
    };
  }

  const igRaw = b.instagram;
  const instagram =
    igRaw == null || igRaw === ''
      ? null
      : typeof igRaw === 'string'
        ? igRaw.trim().slice(0, 50)
        : null;

  const cpRaw = b.contactPreference ?? b.contact_preference;
  const cp = typeof cpRaw === 'string' ? cpRaw.trim().slice(0, 10) : '';
  if (!cp) {
    return { ok: /** @type {const} */ (false), error: 'contactPreference가 필요합니다.' };
  }

  if (!genderGuess) {
    return { ok: /** @type {const} */ (false), error: 'gender는 M 또는 F 이어야 합니다.' };
  }

  return {
    ok: /** @type {const} */ (true),
    value: {
      peopleCount,
      vibe,
      gender: /** @type {'M'|'F'} */ (genderGuess),
      phone: phoneNormalized,
      instagram,
      contactPreference: cp,
    },
  };
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function allocateReceptionIdInsideTx(tx) {
  for (let i = 0; i < 12; i += 1) {
    const cand = `F${crypto.randomBytes(12).toString('hex')}`.slice(0, 32);
    const exists = await tx.festivalApplication.findUnique({
      where: { receptionId: cand },
      select: { id: true },
    });
    if (!exists) return cand;
  }
  throw new Error('FESTIVAL_RECEPTION_ID_COLLISION');
}

/**
 * @param {import('@prisma/client').FestivalApplication} row
 * @param {import('../lib/festivalSlotPolicy').FestivalSlotHours} hours
 */
function applicationJson(row, hours) {
  const ymd = ymdFromPrismaDateOnly(row.appliedLocalDate);
  const { slot1Utc, slot2Utc } = slotUtcStarts(ymd, hours);
  return {
    receptionId: row.receptionId,
    matchingSlot: row.matchingSlot,
    appliedLocalDateKst: ymd,
    peopleCount: row.peopleCount,
    vibe: row.vibe,
    gender: row.gender,
    phone: row.phone,
    instagram: row.instagram,
    contactPreference: row.contactPreference,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    slot1MatchAtUtc: slot1Utc ? slot1Utc.toISOString() : null,
    slot2MatchAtUtc: slot2Utc ? slot2Utc.toISOString() : null,
  };
}

/**
 * GET /api/festival/me
 * — 오늘·회차 기준으로 “화면에 보일 신청”만 내려줍니다(14시 지난 1회차 APPLIED 는 NONE).
 * — `?phone=` 또는 `x-festival-phone` (010… 11자리, 본인인증 없음).
 */
router.get('/me', requireFestivalPhone, async (req, res) => {
  try {
    const now = new Date();
    /** @type {string} */
    const phone = /** @type {{ festivalPhoneNormalized: string }} */ (req).festivalPhoneNormalized;

    const cfg = await prisma.festivalConfig.findFirst({
      where: { isActive: true },
      orderBy: { id: 'asc' },
    });
    if (!cfg) {
      return res.status(503).json({
        error: '축제 설정이 준비되지 않았습니다.',
        code: 'FESTIVAL_CONFIG_MISSING',
      });
    }

    const hours = resolveSlotHoursFromConfig(cfg);
    const kstToday = todayKstYmd(now);
    const { slot1Utc: todaySlot1Utc, slot2Utc: todaySlot2Utc } = kstToday
      ? slotUtcStarts(kstToday, hours)
      : { slot1Utc: null, slot2Utc: null };

    const appliedLocalDay = kstToday ? dateOnlyFromYmd(kstToday) : null;
    const app =
      appliedLocalDay == null
        ? null
        : await prisma.festivalApplication.findUnique({
            where: {
              phone_appliedLocalDate: {
                phone,
                appliedLocalDate: appliedLocalDay,
              },
            },
          });

    const base = {
      nowUtc: now.toISOString(),
      nowKstDate: kstToday,
      scheduleTodayKst: {
        slot1MatchHourKst: hours.slot1MatchHour,
        slot2MatchHourKst: hours.slot2MatchHour,
        slot1MatchAtUtc: todaySlot1Utc ? todaySlot1Utc.toISOString() : null,
        slot2MatchAtUtc: todaySlot2Utc ? todaySlot2Utc.toISOString() : null,
      },
      config: {
        matchTargetTime: cfg.matchTargetTime.toISOString(),
        maxCapacityPerGender: cfg.maxCapacityPerGender,
      },
    };

    if (!app || app.status === 'DROPPED') {
      if (app && app.status === 'DROPPED') {
        return res.status(200).json({
          ...base,
          visibility: 'DROPPED',
          inactiveReason: null,
          closedSlot: null,
          application: applicationJson(app, hours),
        });
      }
      return res.status(200).json({
        ...base,
        visibility: 'NONE',
        inactiveReason: null,
        closedSlot: null,
        application: null,
      });
    }

    const visPass = applicationVisibleAfterSlotPass(now, app.appliedLocalDate, app.matchingSlot, app.status, hours);

    if (app.status === 'MATCHED') {
      return res.status(200).json({
        ...base,
        visibility: 'MATCHED',
        inactiveReason: null,
        closedSlot: null,
        application: applicationJson(app, hours),
      });
    }

    if (app.status === 'APPLIED' && !visPass.visible) {
      return res.status(200).json({
        ...base,
        visibility: 'NONE',
        inactiveReason: 'SLOT_MATCH_TIME_PASSED',
        closedSlot: visPass.closedSlot ?? null,
        application: null,
      });
    }

    return res.status(200).json({
      ...base,
      visibility: 'ACTIVE',
      inactiveReason: null,
      closedSlot: null,
      application: applicationJson(app, hours),
    });
  } catch (err) {
    console.error('festival GET /me:', err);
    return res.status(500).json({ error: '조회 중 오류가 발생했습니다.' });
  }
});

/**
 * POST /api/festival/mood-apply
 */
router.post('/mood-apply', async (req, res) => {
  const parsed = parseMoodApplyBody(req.body);
  if (!parsed.ok) {
    return res.status(400).json({ error: parsed.error });
  }

  try {
    const outcome = await prisma.$transaction(
      async (tx) => {
        const cfg = await tx.festivalConfig.findFirst({
          where: { isActive: true },
          orderBy: { id: 'asc' },
        });
        if (!cfg) {
          return { tag: 'no_config', error: '축제 설정이 준비되지 않았습니다.' };
        }
        const now = new Date();
        const kstToday = todayKstYmd(now);
        if (!kstToday) {
          return { tag: 'no_config', error: '시간대 정보를 처리할 수 없습니다.' };
        }

        const hours = resolveSlotHoursFromConfig(cfg);
        const submission = resolveSlotForSubmission(now, kstToday, hours);
        if (!submission.slot) {
          return { tag: 'closed', error: submission.errorMessage || '신청 접수가 마감되었습니다.' };
        }

        const targetSlot = submission.slot;
        const appliedLocalDate = submission.appliedLocalDate;

        const { slot1Utc, slot2Utc } = slotUtcStarts(kstToday, hours);
        if (!slot1Utc || !slot2Utc) {
          return { tag: 'no_config', error: '매칭 슬롯 시각 설정이 올바르지 않습니다.' };
        }

        const form = parsed.value;
        const capWhere = /** @type {const} */ ({
          gender: form.gender,
          status: 'APPLIED',
          deletedAt: null,
          matchingSlot: targetSlot,
          appliedLocalDate,
        });

        const phoneDateKey = { phone: form.phone, appliedLocalDate };

        const existing = await tx.festivalApplication.findUnique({
          where: { phone_appliedLocalDate: phoneDateKey },
        });

        async function countCap() {
          return tx.festivalApplication.count({
            where: capWhere,
          });
        }

        /** @returns {Promise<{ tag: string, receptionId?: string, status?: string, matchingSlot?: number }>} */
        async function upsertApplied({ receptionId }) {
          if (existing && existing.status === 'DROPPED') {
            const updated = await tx.festivalApplication.update({
              where: { phone_appliedLocalDate: phoneDateKey },
              data: {
                receptionId,
                matchingSlot: targetSlot,
                appliedLocalDate,
                peopleCount: form.peopleCount,
                vibe: form.vibe,
                gender: form.gender,
                phone: form.phone,
                instagram: form.instagram,
                contactPreference: form.contactPreference,
                status: 'APPLIED',
                deletedAt: null,
                createdAt: new Date(),
              },
            });
            return {
              tag: 'ok',
              receptionId: updated.receptionId,
              status: updated.status,
              matchingSlot: updated.matchingSlot,
            };
          }

          const created = await tx.festivalApplication.create({
            data: {
              receptionId,
              matchingSlot: targetSlot,
              appliedLocalDate,
              peopleCount: form.peopleCount,
              vibe: form.vibe,
              gender: form.gender,
              phone: form.phone,
              instagram: form.instagram,
              contactPreference: form.contactPreference,
              status: 'APPLIED',
            },
          });
          return {
            tag: 'ok',
            receptionId: created.receptionId,
            status: created.status,
            matchingSlot: created.matchingSlot,
          };
        }

        if (!existing) {
          const appliedCnt = await countCap();
          if (appliedCnt >= cfg.maxCapacityPerGender) {
            return { tag: 'full' };
          }
          const receptionId = await allocateReceptionIdInsideTx(tx);
          return upsertApplied({ receptionId });
        }

        if (existing.status === 'MATCHED') {
          return { tag: 'conflict_matched', receptionId: existing.receptionId };
        }

        if (existing.status === 'DROPPED') {
          const appliedCnt = await countCap();
          if (appliedCnt >= cfg.maxCapacityPerGender) {
            return { tag: 'full' };
          }
          const receptionId = await allocateReceptionIdInsideTx(tx);
          return upsertApplied({ receptionId });
        }

        if (existing.status === 'APPLIED') {
          const sameDay = ymdFromPrismaDateOnly(existing.appliedLocalDate) === kstToday;

          const isAfternoonUpgrade =
            existing.matchingSlot === 1 &&
            sameDay &&
            now.getTime() >= slot1Utc.getTime() &&
            now.getTime() < slot2Utc.getTime() &&
            targetSlot === 2;

          if (isAfternoonUpgrade) {
            const appliedCnt = await countCap();
            if (appliedCnt >= cfg.maxCapacityPerGender) {
              return { tag: 'full' };
            }
            const receptionId = await allocateReceptionIdInsideTx(tx);
            const updated = await tx.festivalApplication.update({
              where: { phone_appliedLocalDate: phoneDateKey },
              data: {
                receptionId,
                matchingSlot: 2,
                appliedLocalDate,
                peopleCount: form.peopleCount,
                vibe: form.vibe,
                gender: form.gender,
                phone: form.phone,
                instagram: form.instagram,
                contactPreference: form.contactPreference,
                status: 'APPLIED',
                deletedAt: null,
              },
            });
            return {
              tag: 'ok',
              receptionId: updated.receptionId,
              status: updated.status,
              matchingSlot: updated.matchingSlot,
            };
          }

          if (existing.matchingSlot === targetSlot && sameDay) {
            if (existing.gender !== form.gender) {
              const appliedCnt = await countCap();
              if (appliedCnt >= cfg.maxCapacityPerGender) {
                return { tag: 'full' };
              }
            }
            const updated = await tx.festivalApplication.update({
              where: { phone_appliedLocalDate: phoneDateKey },
              data: {
                peopleCount: form.peopleCount,
                vibe: form.vibe,
                gender: form.gender,
                phone: form.phone,
                instagram: form.instagram,
                contactPreference: form.contactPreference,
                status: 'APPLIED',
                deletedAt: null,
              },
            });
            return {
              tag: 'ok',
              receptionId: updated.receptionId,
              status: updated.status,
              matchingSlot: updated.matchingSlot,
            };
          }

          return { tag: 'conflict_applied', receptionId: existing.receptionId };
        }

        return { tag: 'unknown' };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 12_000,
      },
    );

    if (outcome.tag === 'full') {
      return res.status(403).json({
        error: `${parsed.value.gender === 'M' ? '남성' : '여성'} 정원 마감(선착순 종료).`,
        code: 'FESTIVAL_CAPACITY_FULL',
      });
    }
    if (outcome.tag === 'conflict_applied') {
      return res.status(409).json({
        error: '이미 축제 매칭에 신청하셨습니다.',
        code: 'FESTIVAL_ALREADY_APPLIED',
        receptionId: outcome.receptionId,
      });
    }
    if (outcome.tag === 'conflict_matched') {
      return res.status(409).json({
        error: '이미 매칭 처리된 신청입니다.',
        code: 'FESTIVAL_ALREADY_MATCHED',
        receptionId: outcome.receptionId,
      });
    }
    if (outcome.tag === 'closed') {
      return res.status(403).json({
        error: outcome.error ?? '신청 접수가 마감되었습니다.',
        code: 'FESTIVAL_APPLY_CLOSED',
      });
    }
    if (outcome.tag === 'no_config') {
      return res.status(503).json({
        error: outcome.error,
        code: 'FESTIVAL_CONFIG_MISSING',
      });
    }
    if (outcome.tag !== 'ok') {
      return res.status(500).json({ error: '알 수 없는 처리 결과입니다.' });
    }
    return res.status(200).json({
      receptionId: outcome.receptionId,
      status: outcome.status,
      matchingSlot: outcome.matchingSlot,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
      return res.status(409).json({
        error: '동시 접수로 인해 다시 한 번 시도해 주세요.',
        code: 'FESTIVAL_SERIALIZATION_RETRY',
      });
    }
    console.error('festival mood-apply:', err);
    return res.status(500).json({
      error:
        err instanceof Error && err.message === 'FESTIVAL_RECEPTION_ID_COLLISION'
          ? '접수 번호 발번에 실패했습니다.'
          : '신청 처리 중 오류가 발생했습니다.',
    });
  }
});

async function slotGenderCounts(appliedLocalDate, slotNum) {
  /** @type {const} */
  const common = {
    status: 'APPLIED',
    deletedAt: null,
    matchingSlot: slotNum,
    appliedLocalDate,
  };
  const [m, f] = await Promise.all([
    prisma.festivalApplication.count({ where: { ...common, gender: 'M' } }),
    prisma.festivalApplication.count({ where: { ...common, gender: 'F' } }),
  ]);
  return { male: m, female: f };
}

/**
 * GET /api/festival/status
 */
router.get('/status', async (req, res) => {
  try {
    const cfg = await prisma.festivalConfig.findFirst({
      where: { isActive: true },
      orderBy: { id: 'asc' },
    });
    if (!cfg) {
      return res.status(503).json({
        error: '축제 설정이 준비되지 않았습니다.',
        code: 'FESTIVAL_CONFIG_MISSING',
      });
    }

    const kstToday = todayKstYmd(new Date());
    const appliedLocalDay = kstToday ? dateOnlyFromYmd(kstToday) : null;
    const hours = resolveSlotHoursFromConfig(cfg);
    const max = cfg.maxCapacityPerGender;

    let slot1 = { appliedMale: 0, appliedFemale: 0, remainingMale: max, remainingFemale: max };
    let slot2 = { appliedMale: 0, appliedFemale: 0, remainingMale: max, remainingFemale: max };

    if (appliedLocalDay) {
      const c1 = await slotGenderCounts(appliedLocalDay, 1);
      const c2 = await slotGenderCounts(appliedLocalDay, 2);
      slot1 = {
        appliedMale: c1.male,
        appliedFemale: c1.female,
        remainingMale: Math.max(0, max - c1.male),
        remainingFemale: Math.max(0, max - c1.female),
      };
      slot2 = {
        appliedMale: c2.male,
        appliedFemale: c2.female,
        remainingMale: Math.max(0, max - c2.male),
        remainingFemale: Math.max(0, max - c2.female),
      };
    }

    const appliedMaleTotal = slot1.appliedMale + slot2.appliedMale;
    const appliedFemaleTotal = slot1.appliedFemale + slot2.appliedFemale;

    return res.status(200).json({
      appliedLocalDateKst: kstToday,
      matchTargetTime: cfg.matchTargetTime.toISOString(),
      maxCapacityPerGender: max,
      slot1MatchHourKst: hours.slot1MatchHour,
      slot2MatchHourKst: hours.slot2MatchHour,
      slots: {
        1: slot1,
        2: slot2,
      },
      appliedMale: appliedMaleTotal,
      appliedFemale: appliedFemaleTotal,
      remainingMale: Math.max(0, max - appliedMaleTotal),
      remainingFemale: Math.max(0, max - appliedFemaleTotal),
      isActive: cfg.isActive,
    });
  } catch (err) {
    console.error('festival status:', err);
    return res.status(500).json({ error: '상태 조회 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
