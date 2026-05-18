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
  ymdFromPrismaDateOnly,
  dateOnlyFromYmd,
} = require('../lib/festivalSlotPolicy');
const { isFestivalBoothCodeEnabled, verifyFestivalBoothCodeFromRequestBody } = require('../lib/festivalBoothHourCode');

const router = express.Router();

/** 같은 KST 일자 `APPLIED` 남성 최대 명수(여성 인원 이하 규칙과 함께 적용). */
const FESTIVAL_MAX_MALE_APPLIED_PER_DAY = 30;

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
 * 같은 일자 풀에서 남성 신청 불가 조건:
 * - 남성 APPLIED ≥ 여성 APPLIED 이거나
 * - 남성 APPLIED ≥ {@link FESTIVAL_MAX_MALE_APPLIED_PER_DAY}.
 * 여성은 별도 상한 없음.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function countFestivalAppliedGenderForDate(tx, appliedLocalDate, gender) {
  return tx.festivalApplication.count({
    where: {
      gender,
      status: 'APPLIED',
      deletedAt: null,
      appliedLocalDate,
    },
  });
}

/** @param {import('@prisma/client').FestivalApplication} row */
function applicationJson(row) {
  const ymd = ymdFromPrismaDateOnly(row.appliedLocalDate);
  return {
    receptionId: row.receptionId,
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
    partnerPhone: row.partnerPhone ?? null,
    partnerReceptionId: row.partnerReceptionId ?? null,
    matchedAt: row.matchedAt ? row.matchedAt.toISOString() : null,
  };
}

/**
 * GET /api/festival/me
 * — KST 같은 날 `phone·appliedLocalDate` 유니크 1건을 내려줍니다(당일 단일 대기 풀·매칭은 관리자 `match-run` 시점).
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
        femaleCapacityUnlimited: true,
        maleCapacityMatchesFemaleApplicants: true,
        maleAppliedHardCapPerDay: FESTIVAL_MAX_MALE_APPLIED_PER_DAY,
        boothCodeRequired: isFestivalBoothCodeEnabled(),
      },
    };

    if (!app || app.status === 'DROPPED') {
      if (app && app.status === 'DROPPED') {
        return res.status(200).json({
          ...base,
          visibility: 'DROPPED',
          inactiveReason: null,
          closedSlot: null,
          application: applicationJson(app),
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

    if (app.status === 'MATCHED') {
      return res.status(200).json({
        ...base,
        visibility: 'MATCHED',
        inactiveReason: null,
        closedSlot: null,
        application: applicationJson(app),
      });
    }

    return res.status(200).json({
      ...base,
      visibility: 'ACTIVE',
      inactiveReason: null,
      closedSlot: null,
      application: applicationJson(app),
    });
  } catch (err) {
    console.error('festival GET /me:', err);
    return res.status(500).json({ error: '조회 중 오류가 발생했습니다.' });
  }
});

/**
 * POST /api/festival/verify-onsite-code
 * Body: `{ boothCode }` 또는 `{ booth_code }` — 현장 부스 코드만 검증합니다(신청 처리 없음).
 * `FESTIVAL_BOOTH_CODE_SECRET` 미설정 시 검증 생략으로 성공합니다.
 */
router.post('/verify-onsite-code', async (req, res) => {
  try {
    const bodyObj =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? /** @type {Record<string, unknown>} */ (req.body)
        : {};

    if (!isFestivalBoothCodeEnabled()) {
      return res.status(200).json({
        ok: true,
        boothCodeRequired: false,
        message: '부스 코드 검증이 비활성입니다.',
      });
    }

    const boothFail = verifyFestivalBoothCodeFromRequestBody(bodyObj);
    if (boothFail) {
      return res.status(403).json({
        ok: false,
        error: boothFail.error,
        code: 'FESTIVAL_BOOTH_CODE_INVALID',
      });
    }

    return res.status(200).json({
      ok: true,
      boothCodeRequired: true,
    });
  } catch (err) {
    console.error('festival POST verify-onsite-code:', err);
    return res.status(500).json({ error: '확인 처리 중 오류가 발생했습니다.' });
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

  const bodyObj =
    req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? /** @type {Record<string, unknown>} */ (req.body)
      : {};
  const boothFail = verifyFestivalBoothCodeFromRequestBody(bodyObj);
  if (boothFail) {
    return res.status(403).json({
      error: boothFail.error,
      code: 'FESTIVAL_BOOTH_CODE_INVALID',
    });
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

        const appliedLocalDate = dateOnlyFromYmd(kstToday);

        const form = parsed.value;

        const phoneDateKey = { phone: form.phone, appliedLocalDate };

        const existing = await tx.festivalApplication.findUnique({
          where: { phone_appliedLocalDate: phoneDateKey },
        });

        /** 남성 신청·성별 변경 시: 여성 인원 미만이면서 남성 30명 미만이어야 함 */
        async function isMaleDayFull() {
          const [mCnt, fCnt] = await Promise.all([
            countFestivalAppliedGenderForDate(tx, appliedLocalDate, 'M'),
            countFestivalAppliedGenderForDate(tx, appliedLocalDate, 'F'),
          ]);
          return mCnt >= fCnt || mCnt >= FESTIVAL_MAX_MALE_APPLIED_PER_DAY;
        }

        /** @returns {Promise<{ tag: string, receptionId?: string, status?: string }>} */
        async function upsertApplied({ receptionId }) {
          if (existing && existing.status === 'DROPPED') {
            const updated = await tx.festivalApplication.update({
              where: { phone_appliedLocalDate: phoneDateKey },
              data: {
                receptionId,
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
            };
          }

          const created = await tx.festivalApplication.create({
            data: {
              receptionId,
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
          };
        }

        if (!existing) {
          if (form.gender === 'M' && (await isMaleDayFull())) {
            return { tag: 'full' };
          }
          const receptionId = await allocateReceptionIdInsideTx(tx);
          return upsertApplied({ receptionId });
        }

        if (existing.status === 'MATCHED') {
          return { tag: 'conflict_matched', receptionId: existing.receptionId };
        }

        if (existing.status === 'DROPPED') {
          if (form.gender === 'M' && (await isMaleDayFull())) {
            return { tag: 'full' };
          }
          const receptionId = await allocateReceptionIdInsideTx(tx);
          return upsertApplied({ receptionId });
        }

        if (existing.status === 'APPLIED') {
          const sameDay = ymdFromPrismaDateOnly(existing.appliedLocalDate) === kstToday;

          if (sameDay) {
            if (existing.gender !== form.gender) {
              if (form.gender === 'M' && existing.gender === 'F') {
                const mCnt = await countFestivalAppliedGenderForDate(tx, appliedLocalDate, 'M');
                const fCnt = await countFestivalAppliedGenderForDate(tx, appliedLocalDate, 'F');
                if (mCnt + 2 > fCnt || mCnt + 1 > FESTIVAL_MAX_MALE_APPLIED_PER_DAY) {
                  return { tag: 'full' };
                }
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
      const isMaleCase = parsed.value.gender === 'M';
      return res.status(403).json({
        error: isMaleCase
          ? `남성 신청은 같은 날짜의 여성 신청 인원 이하여야 하며, 최대 ${FESTIVAL_MAX_MALE_APPLIED_PER_DAY}명까지 접수됩니다.`
          : '신청 정원이 마감되었습니다.',
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

async function dayAppliedGenderCounts(appliedLocalDate) {
  /** @type {const} */
  const common = {
    status: 'APPLIED',
    deletedAt: null,
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

    let appliedMale = 0;
    let appliedFemale = 0;
    let remainingMale = 0;
    let pairablePairs = 0;

    if (appliedLocalDay) {
      const c = await dayAppliedGenderCounts(appliedLocalDay);
      appliedMale = c.male;
      appliedFemale = c.female;
      remainingMale = Math.min(
        Math.max(0, c.female - c.male),
        Math.max(0, FESTIVAL_MAX_MALE_APPLIED_PER_DAY - c.male),
      );
      pairablePairs = Math.min(c.male, c.female);
    }

    return res.status(200).json({
      appliedLocalDateKst: kstToday,
      matchTargetTime: cfg.matchTargetTime.toISOString(),
      maxCapacityPerGender: cfg.maxCapacityPerGender,
      femaleCapacityUnlimited: true,
      maleCapacityMatchesFemaleApplicants: true,
      maleAppliedHardCapPerDay: FESTIVAL_MAX_MALE_APPLIED_PER_DAY,
      boothCodeRequired: isFestivalBoothCodeEnabled(),
      scheduleNoteKst:
        '`slot1_match_hour` 등은 참고용 표시일 뿐이며, 매칭 시점은 관리자가 `match-run`을 실행할 때 결정됩니다.',
      slot1MatchHourKst: hours.slot1MatchHour,
      slot2MatchHourKst: hours.slot2MatchHour,
      waitingPoolTodayKst: appliedLocalDay
        ? {
            appliedMale,
            appliedFemale,
            remainingMaleSlotsVsFemaleApplicants: remainingMale,
            remainingFemale: null,
            pairablePairsThisRun: pairablePairs,
          }
        : null,
      appliedMale,
      appliedFemale,
      remainingMale,
      remainingFemale: null,
      isActive: cfg.isActive,
    });
  } catch (err) {
    console.error('festival status:', err);
    return res.status(500).json({ error: '상태 조회 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
