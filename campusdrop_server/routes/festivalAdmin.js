const express = require('express');
const { Prisma } = require('@prisma/client');
const { adminAuthMiddleware } = require('../lib/adminAuth');
const { prisma } = require('../lib/prisma');
const { normalizeKoMobile } = require('../lib/festivalPhone');
const { dateOnlyFromYmd } = require('../lib/festivalSlotPolicy');
const {
  assertSolapiFriendTalkEnv,
  sendFriendTalkCta,
  getKakaoFriendTalkImageIdFromEnv,
  FRIEND_TALK_IMG_MATCH_SUCCESS,
} = require('../lib/solapiFriendTalkSend');
const { writeAccessLog } = require('../lib/accessLog');
const { runFestivalPairing } = require('../lib/festivalAdminMatch');
const { buildFestivalMatchFriendTalkText } = require('../lib/festivalMatchNotifyText');

const router = express.Router();

/** @param {unknown} raw */
function parseKstDateQuery(raw) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = dateOnlyFromYmd(s);
  if (Number.isNaN(d.getTime())) return null;
  return { ymd: s, date: d };
}

/** @param {string} ymd */
function kstWeekMeta(ymd) {
  const inst = new Date(`${ymd}T12:00:00+09:00`);
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short' }).format(inst);
  const isWeekend = wd === 'Sat' || wd === 'Sun';
  return { weekdayKstShort: wd, isWeekendKst: isWeekend };
}

/** @param {unknown} raw */
function phoneFilterWhere(raw) {
  if (raw == null || raw === '') return {};
  const n = normalizeKoMobile(raw);
  if (n.length === 11 && n.startsWith('01')) return { phone: n };
  if (n.length >= 4) return { phone: { contains: n } };
  return {};
}

function festivalDropFriendTalkText() {
  const raw = String(process.env.FESTIVAL_DROP_FRIENDTALK_TEXT || '').trim();
  if (raw) return raw.slice(0, 1000);
  return `[축제 매칭] 안내 연락드립니다.

이번 축제 매칭은 아쉽게도 포함되기 어려운 상태예요.
자세한 내용은 카카오 채널 등 안내 페이지를 통해 확인 부탁드립니다.

감사합니다.`;
}

/**
 * GET /api/admin/festival/applications
 * Query: date=YYYY-MM-DD (필수), slot=1|2 (선택), phone= (선택), status=APPLIED|MATCHED|DROPPED (선택)
 */
router.get('/festival/applications', adminAuthMiddleware, async (req, res) => {
  try {
    const parsed = parseKstDateQuery(req.query?.date);
    if (!parsed) {
      return res.status(400).json({ error: 'date 쿼리(YYYY-MM-DD, KST 달력)가 필요합니다.' });
    }

    const slotRaw = req.query?.slot;
    const s0 = Array.isArray(slotRaw) ? slotRaw[0] : slotRaw;
    const slot =
      s0 === '1' || s0 === 1
        ? 1
        : s0 === '2' || s0 === 2
          ? 2
          : null;
    const statusRaw = typeof req.query?.status === 'string' ? req.query.status.trim().toUpperCase() : '';
    const status =
      statusRaw === 'APPLIED' || statusRaw === 'MATCHED' || statusRaw === 'DROPPED' ? statusRaw : null;

    const phonePart = phoneFilterWhere(req.query?.phone);

    const slotsToQuery = slot != null ? [slot] : /** @type {const} */ ([1, 2]);
    const week = kstWeekMeta(parsed.ymd);

    /** @type {Record<string, unknown>} */
    const baseWhere = {
      appliedLocalDate: parsed.date,
      ...phonePart,
    };
    if (status) Object.assign(baseWhere, { status });

    /** @type {Record<string, { matchingSlot: number, summary: Record<string, unknown>, applications: unknown[] }>} */
    const slots = {};

    for (const sn of slotsToQuery) {
      const where = { ...baseWhere, matchingSlot: sn };
      const applications = await prisma.festivalApplication.findMany({
        where,
        orderBy: [{ status: 'asc' }, { gender: 'asc' }, { id: 'asc' }],
      });

      /** @type {Record<string, Record<string, number>>} */
      const summary = { APPLIED: { M: 0, F: 0 }, MATCHED: { M: 0, F: 0 }, DROPPED: { M: 0, F: 0 } };
      for (const row of applications) {
        const g = row.gender === 'M' || row.gender === 'F' ? row.gender : null;
        const st = row.status === 'APPLIED' || row.status === 'MATCHED' || row.status === 'DROPPED' ? row.status : null;
        if (g && st) summary[st][g] += 1;
      }

      slots[String(sn)] = {
        matchingSlot: sn,
        summary: {
          APPLIED: { ...summary.APPLIED, total: summary.APPLIED.M + summary.APPLIED.F },
          MATCHED: { ...summary.MATCHED, total: summary.MATCHED.M + summary.MATCHED.F },
          DROPPED: { ...summary.DROPPED, total: summary.DROPPED.M + summary.DROPPED.F },
        },
        applications: applications.map((a) => ({
          id: String(a.id),
          receptionId: a.receptionId,
          matchingSlot: a.matchingSlot,
          appliedLocalDateKst: parsed.ymd,
          peopleCount: a.peopleCount,
          vibe: a.vibe,
          gender: a.gender,
          phone: a.phone,
          instagram: a.instagram,
          contactPreference: a.contactPreference,
          status: a.status,
          createdAt: a.createdAt.toISOString(),
          deletedAt: a.deletedAt ? a.deletedAt.toISOString() : null,
          partnerPhone: a.partnerPhone,
          partnerReceptionId: a.partnerReceptionId,
          matchedAt: a.matchedAt ? a.matchedAt.toISOString() : null,
        })),
      };
    }

    return res.status(200).json({
      appliedLocalDateKst: parsed.ymd,
      scheduleNoteKst: '월~금 각 일자별 14시·17시 회차(슬롯 1·2) — `FestivalConfig.slot1_match_hour` / `slot2_match_hour`',
      kst: week,
      slots,
    });
  } catch (err) {
    console.error('admin GET festival/applications:', err);
    return res.status(500).json({ error: '목록 조회 중 오류가 발생했습니다.' });
  }
});

/**
 * POST /api/admin/festival/match-run
 * Body: { appliedLocalDate: "YYYY-MM-DD", matchingSlot: 1|2 } — 해당 일자·슬롯 `APPLIED` 이성 1:1 매칭 후 친구톡.
 */
router.post('/festival/match-run', adminAuthMiddleware, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const ds =
      typeof body.appliedLocalDate === 'string'
        ? body.appliedLocalDate.trim()
        : typeof body.date === 'string'
          ? body.date.trim()
          : '';
    const parsed = parseKstDateQuery(ds);
    if (!parsed) {
      return res.status(400).json({ error: 'appliedLocalDate 또는 date(YYYY-MM-DD)가 필요합니다.' });
    }

    const slotNum = Number(body.matchingSlot ?? body.matching_slot);
    if (slotNum !== 1 && slotNum !== 2) {
      return res.status(400).json({ error: 'matchingSlot은 1 또는 2여야 합니다.' });
    }

    const cfgEnv = assertSolapiFriendTalkEnv();
    if (cfgEnv) {
      return res.status(503).json({
        error: `알림 발송 설정이 불완전합니다: ${cfgEnv}`,
        code: 'SOLAPI_ENV_MISSING',
      });
    }

    /** @type {{ pairedCount: number, unmatchedMale: number, unmatchedFemale: number, pairs: { male: import('@prisma/client').FestivalApplication, female: import('@prisma/client').FestivalApplication }[] } | null} */
    let runResult = null;

    try {
      runResult = await prisma.$transaction(
        async (tx) => {
          const appliedCnt = await tx.festivalApplication.count({
            where: {
              appliedLocalDate: parsed.date,
              matchingSlot: slotNum,
              deletedAt: null,
              status: 'APPLIED',
            },
          });
          if (appliedCnt === 0) {
            return null;
          }
          return runFestivalPairing(tx, { appliedLocalDate: parsed.date, matchingSlot: slotNum });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5000,
          timeout: 20_000,
        },
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
        return res.status(409).json({
          error: '동시 처리로 인해 다시 시도해 주세요.',
          code: 'FESTIVAL_ADMIN_SERIALIZATION_RETRY',
        });
      }
      throw err;
    }

    if (runResult == null) {
      return res.status(400).json({
        error: '해당 일자·슬롯에 매칭할 APPLIED 신청이 없습니다.',
        code: 'FESTIVAL_NO_APPLICATIONS_TO_MATCH',
      });
    }

    const imgId = await getKakaoFriendTalkImageIdFromEnv(FRIEND_TALK_IMG_MATCH_SUCCESS);
    /** @type {{ phone: string, error: string }[]} */
    const notifyFailures = [];

    for (const p of runResult.pairs) {
      const { male: m, female: f } = p;
      const textM = buildFestivalMatchFriendTalkText(
        { receptionId: m.receptionId, phone: m.phone },
        {
          receptionId: f.receptionId,
          phone: f.phone,
          instagram: f.instagram,
          contactPreference: f.contactPreference,
          peopleCount: f.peopleCount,
          vibe: f.vibe,
        },
        'M',
      );
      const textF = buildFestivalMatchFriendTalkText(
        { receptionId: f.receptionId, phone: f.phone },
        {
          receptionId: m.receptionId,
          phone: m.phone,
          instagram: m.instagram,
          contactPreference: m.contactPreference,
          peopleCount: m.peopleCount,
          vibe: m.vibe,
        },
        'F',
      );
      try {
        await sendFriendTalkCta({ to: m.phone, text: textM, kakaoImageId: imgId });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        notifyFailures.push({ phone: m.phone, error: msg });
        console.error('[festival-admin-match] 친구톡 실패(남):', m.phone, e);
      }
      try {
        await sendFriendTalkCta({ to: f.phone, text: textF, kakaoImageId: imgId });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        notifyFailures.push({ phone: f.phone, error: msg });
        console.error('[festival-admin-match] 친구톡 실패(여):', f.phone, e);
      }
    }

    await writeAccessLog({
      actorType: 'admin',
      actorId: req.admin?.adminId ?? null,
      action: 'FESTIVAL_ADMIN_MATCH_RUN',
      resource: `Festival:${parsed.ymd}:slot${slotNum}`,
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: {
        pairedCount: runResult.pairedCount,
        unmatchedMale: runResult.unmatchedMale,
        unmatchedFemale: runResult.unmatchedFemale,
        notifyFailureCount: notifyFailures.length,
      },
    });

    return res.status(200).json({
      ok: true,
      appliedLocalDateKst: parsed.ymd,
      matchingSlot: slotNum,
      pairedCount: runResult.pairedCount,
      unmatchedMale: runResult.unmatchedMale,
      unmatchedFemale: runResult.unmatchedFemale,
      notifyFailures,
    });
  } catch (err) {
    console.error('admin POST festival/match-run:', err);
    return res.status(500).json({ error: '매칭 처리 중 오류가 발생했습니다.' });
  }
});

/**
 * POST /api/admin/festival/drop
 * Body `{ "phone": "010-xxxx-xxxx" }` — 상태 APPLIED만 Drop 후 친구톡 알림 후 소프트 삭제.
 */
router.post('/festival/drop', adminAuthMiddleware, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const phoneRaw = typeof body.phone === 'string' ? body.phone.trim() : '';
    if (!phoneRaw) {
      return res.status(400).json({ error: 'phone이 필요합니다.' });
    }
    const phoneNorm = normalizeKoMobile(phoneRaw);
    if (!(phoneNorm.length === 11 && phoneNorm.startsWith('01'))) {
      return res.status(400).json({ error: '휴대폰 번호(010 포함 11자리) 형식이어야 합니다.' });
    }

    let row =
      (await prisma.festivalApplication.findFirst({
        where: {
          deletedAt: null,
          phone: phoneNorm,
          status: 'APPLIED',
        },
        select: {
          id: true,
          receptionId: true,
          phone: true,
          status: true,
        },
        orderBy: { id: 'desc' },
      })) ??
      (await prisma.festivalApplication.findFirst({
        where: { deletedAt: null, phone: phoneNorm },
        select: {
          id: true,
          receptionId: true,
          phone: true,
          status: true,
        },
        orderBy: { id: 'desc' },
      }));

    if (!row) {
      return res.status(404).json({ error: '해당 번호의 축제 신청을 찾을 수 없습니다.' });
    }
    if (row.status !== 'APPLIED') {
      return res.status(409).json({
        error: `이미 처리된 신청입니다. (status:${row.status})`,
        receptionId: row.receptionId,
      });
    }

    const cfgMissing = assertSolapiFriendTalkEnv();
    if (cfgMissing) {
      return res.status(503).json({
        error: `알림 발송 설정이 불완전합니다: ${cfgMissing}`,
        code: 'SOLAPI_ENV_MISSING',
      });
    }

    try {
      await sendFriendTalkCta({ to: phoneNorm, text: festivalDropFriendTalkText() });
    } catch (err) {
      console.error('[festival-admin-drop] Solapi 친구톡 발송 실패:', err);
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(502).json({
        error: '알림 발송 실패로 Drop가 완료되지 않았습니다.',
        detail: msg,
        code: 'FESTIVAL_NOTIFY_FAILED',
      });
    }

    const now = new Date();
    const updated = await prisma.festivalApplication.update({
      where: { id: row.id },
      data: {
        status: 'DROPPED',
        deletedAt: now,
      },
    });

    await writeAccessLog({
      actorType: 'admin',
      actorId: req.admin?.adminId ?? null,
      action: 'FESTIVAL_ADMIN_DROP',
      resource: `FestivalApplication:${String(updated.id)}`,
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: { receptionId: updated.receptionId, phoneMasked: `${phoneNorm.slice(0, 4)}***` },
    });

    return res.status(200).json({
      ok: true,
      receptionId: updated.receptionId,
      status: updated.status,
    });
  } catch (err) {
    console.error('admin festival/drop:', err);
    return res.status(500).json({ error: 'Drop 처리 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
