const crypto = require('crypto');
const express = require('express');
const { Prisma } = require('@prisma/client');
const { prisma } = require('../lib/prisma');
const { requireFestivalUserUuid } = require('../lib/requireFestivalUser');
const { normalizeKoMobile } = require('../lib/festivalPhone');

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
 * POST /api/festival/mood-apply
 */
router.post('/mood-apply', requireFestivalUserUuid, async (req, res) => {
  const parsed = parseMoodApplyBody(req.body);
  if (!parsed.ok) {
    return res.status(400).json({ error: parsed.error });
  }

  /** @type {import('@prisma/client').FestivalUser} */
  const fu = req.festivalUser;

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
        const capacity = cfg.maxCapacityPerGender;

        const existing = await tx.festivalApplication.findUnique({
          where: { userId: fu.id },
        });

        if (existing && existing.status === 'APPLIED') {
          return { tag: 'conflict_applied', receptionId: existing.receptionId };
        }
        if (existing && existing.status === 'MATCHED') {
          return { tag: 'conflict_matched', receptionId: existing.receptionId };
        }

        const appliedCnt = await tx.festivalApplication.count({
          where: { gender: parsed.value.gender, status: 'APPLIED', deletedAt: null },
        });
        if (appliedCnt >= capacity) {
          return { tag: 'full' };
        }

        const receptionId = await allocateReceptionIdInsideTx(tx);
        const form = parsed.value;

        if (existing && existing.status === 'DROPPED') {
          const updated = await tx.festivalApplication.update({
            where: { userId: fu.id },
            data: {
              receptionId,
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
          return { tag: 'ok', receptionId: updated.receptionId, status: updated.status };
        }

        const created = await tx.festivalApplication.create({
          data: {
            userId: fu.id,
            receptionId,
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
    const maleCnt = await prisma.festivalApplication.count({
      where: { gender: 'M', status: 'APPLIED', deletedAt: null },
    });
    const femaleCnt = await prisma.festivalApplication.count({
      where: { gender: 'F', status: 'APPLIED', deletedAt: null },
    });
    const max = cfg.maxCapacityPerGender;
    return res.status(200).json({
      matchTargetTime: cfg.matchTargetTime.toISOString(),
      maxCapacityPerGender: max,
      appliedMale: maleCnt,
      appliedFemale: femaleCnt,
      remainingMale: Math.max(0, max - maleCnt),
      remainingFemale: Math.max(0, max - femaleCnt),
      isActive: cfg.isActive,
    });
  } catch (err) {
    console.error('festival status:', err);
    return res.status(500).json({ error: '상태 조회 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
