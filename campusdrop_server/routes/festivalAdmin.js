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
const { isFestivalBoothCodeEnabled, getFestivalBoothCodeForAdmin } = require('../lib/festivalBoothHourCode');

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

/** @param {unknown} body */
function parseFestivalAdminPhoneBody(body) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const phoneRaw = typeof b.phone === 'string' ? b.phone.trim() : '';
  if (!phoneRaw) {
    return { ok: /** @type {const} */ (false), status: 400, error: 'phone이 필요합니다.' };
  }
  const phoneNorm = normalizeKoMobile(phoneRaw);
  if (!(phoneNorm.length === 11 && phoneNorm.startsWith('01'))) {
    return {
      ok: /** @type {const} */ (false),
      status: 400,
      error: '휴대폰 번호(010 포함 11자리) 형식이어야 합니다.',
    };
  }
  return { ok: /** @type {const} */ (true), phoneNorm };
}

/**
 * @param {string} phoneNorm
 * @returns {Promise<
 *   | { tag: 'not_found' }
 *   | { tag: 'conflict', row: { id: bigint, receptionId: string, phone: string, status: string } }
 *   | { tag: 'ok', row: { id: bigint, receptionId: string, phone: string, status: string } }
 * >}
 */
async function findLatestActiveFestivalApplicationByPhone(phoneNorm) {
  const select = {
    id: true,
    receptionId: true,
    phone: true,
    status: true,
  };
  const row =
    (await prisma.festivalApplication.findFirst({
      where: {
        deletedAt: null,
        phone: phoneNorm,
        status: 'APPLIED',
      },
      select,
      orderBy: { id: 'desc' },
    })) ??
    (await prisma.festivalApplication.findFirst({
      where: { deletedAt: null, phone: phoneNorm },
      select,
      orderBy: { id: 'desc' },
    }));

  if (!row) return { tag: /** @type {const} */ ('not_found') };
  if (row.status !== 'APPLIED') {
    return { tag: /** @type {const} */ ('conflict'), row };
  }
  return { tag: /** @type {const} */ ('ok'), row };
}

function festivalDropFriendTalkText() {
  const raw = String(process.env.FESTIVAL_DROP_FRIENDTALK_TEXT || '').trim();
  if (raw) return raw.slice(0, 1000);
  return `🚨 [매칭부스 경고] 🚨

누군가 당신의 매칭 자리를
단숨에 빼앗았습니다!

- - - - - - - - - - - - - - -

기껏 신청해둔 내 자리,
이대로 뺏기고만 있을 순 없죠. 🔥

다시 부스로 오셔서
내 자리를 뻔뻔하게 차지한 그 사람을
다시 밀어내세요! 🥊`.slice(0, 1000);
}

/**
 * GET /api/admin/festival/booth-code
 * 현장 부스 LCD·프린트 안내용 코드. KST 기준 매 정시마다 변경. `FESTIVAL_BOOTH_CODE_SECRET` 설정 시에만 의미 있음.
 */
router.get('/festival/booth-code', adminAuthMiddleware, async (_req, res) => {
  try {
    if (!isFestivalBoothCodeEnabled()) {
      return res.status(200).json({
        enabled: false,
        message:
          'FESTIVAL_BOOTH_CODE_SECRET 가 비어 있어 부스 코드 검증이 비활성입니다. 신청 API는 코드 없이 접수됩니다.',
      });
    }
    const payload = getFestivalBoothCodeForAdmin();
    return res.status(200).json({ enabled: true, ...payload });
  } catch (err) {
    console.error('admin GET festival/booth-code:', err);
    return res.status(500).json({ error: '부스 코드를 생성하지 못했습니다.' });
  }
});

/**
 * GET /api/admin/festival/applications
 * Query: date=YYYY-MM-DD (필수), phone= (선택), status=APPLIED|MATCHED|DROPPED|ALL (선택, 기본 APPLIED — 매칭·드랍 전 대기 목록)
 */
router.get('/festival/applications', adminAuthMiddleware, async (req, res) => {
  try {
    const parsed = parseKstDateQuery(req.query?.date);
    if (!parsed) {
      return res.status(400).json({ error: 'date 쿼리(YYYY-MM-DD, KST 달력)가 필요합니다.' });
    }

    const statusRaw = typeof req.query?.status === 'string' ? req.query.status.trim().toUpperCase() : '';

    /** @type {Record<string, unknown>} */
    let statusWhere = { status: 'APPLIED' };
    /** @type {Record<string, unknown>} */
    let deletedPart = { deletedAt: null };

    if (statusRaw === 'ALL') {
      statusWhere = {};
      deletedPart = {};
    } else if (statusRaw === 'DROPPED') {
      statusWhere = { status: 'DROPPED' };
      deletedPart = {};
    } else if (statusRaw === 'MATCHED' || statusRaw === 'APPLIED') {
      statusWhere = { status: statusRaw };
    }

    const phonePart = phoneFilterWhere(req.query?.phone);
    const week = kstWeekMeta(parsed.ymd);

    /** @type {Record<string, unknown>} */
    const baseWhere = {
      appliedLocalDate: parsed.date,
      ...deletedPart,
      ...phonePart,
      ...statusWhere,
    };

    const applications = await prisma.festivalApplication.findMany({
      where: baseWhere,
      orderBy: [{ status: 'asc' }, { gender: 'asc' }, { id: 'asc' }],
    });

    const [waitingMale, waitingFemale, matchedTotal, droppedTotal] = await Promise.all([
      prisma.festivalApplication.count({
        where: { appliedLocalDate: parsed.date, deletedAt: null, status: 'APPLIED', gender: 'M' },
      }),
      prisma.festivalApplication.count({
        where: { appliedLocalDate: parsed.date, deletedAt: null, status: 'APPLIED', gender: 'F' },
      }),
      prisma.festivalApplication.count({
        where: { appliedLocalDate: parsed.date, deletedAt: null, status: 'MATCHED' },
      }),
      prisma.festivalApplication.count({
        where: { appliedLocalDate: parsed.date, status: 'DROPPED' },
      }),
    ]);

    const pairablePairsThisRun = Math.min(waitingMale, waitingFemale);

    /** @type {Record<string, Record<string, number>>} */
    const summary = { APPLIED: { M: 0, F: 0 }, MATCHED: { M: 0, F: 0 }, DROPPED: { M: 0, F: 0 } };
    for (const row of applications) {
      const g = row.gender === 'M' || row.gender === 'F' ? row.gender : null;
      const st = row.status === 'APPLIED' || row.status === 'MATCHED' || row.status === 'DROPPED' ? row.status : null;
      if (g && st) summary[st][g] += 1;
    }

    return res.status(200).json({
      appliedLocalDateKst: parsed.ymd,
      noteKst:
        '한 날짜당 하나의 대기 풀입니다. `match-run`은 남·여 전체 팀 수가 같을 때 실행(1명팀/다인팀 수는 각각 달라도 됨). 여팀 기준 5단계 매칭 후 친구톡. `status` 생략 시 `APPLIED`만 반환.',
      kst: week,
      defaultStatusFilter: 'APPLIED',
      dayCounts: {
        waitingMale,
        waitingFemale,
        pairablePairsThisRun,
        surplusMaleIfPaired: Math.max(0, waitingMale - waitingFemale),
        surplusFemaleIfPaired: Math.max(0, waitingFemale - waitingMale),
        matchedTotal,
        droppedTotal,
      },
      summaryForCurrentQuery: {
        APPLIED: { ...summary.APPLIED, total: summary.APPLIED.M + summary.APPLIED.F },
        MATCHED: { ...summary.MATCHED, total: summary.MATCHED.M + summary.MATCHED.F },
        DROPPED: { ...summary.DROPPED, total: summary.DROPPED.M + summary.DROPPED.F },
      },
      applications: applications.map((a) => ({
        id: String(a.id),
        receptionId: a.receptionId,
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
    });
  } catch (err) {
    console.error('admin GET festival/applications:', err);
    return res.status(500).json({ error: '목록 조회 중 오류가 발생했습니다.' });
  }
});

/**
 * POST /api/admin/festival/match-run
 * Body: `{ appliedLocalDate: "YYYY-MM-DD" }` 또는 `{ date: "YYYY-MM-DD" }`
 * — `APPLIED` 풀: 남·여 **전체** 팀 수만 같으면 실행(1명팀/다인팀 코호트 수는 달라도 됨).
 *   여팀 기준 5단계(1명팀 무드→1명팀 무관→다인팀 무드·1명남 포함→다인↔다인→성별만)·친구톡.
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

    const cfgEnv = assertSolapiFriendTalkEnv();
    if (cfgEnv) {
      return res.status(503).json({
        error: `알림 발송 설정이 불완전합니다: ${cfgEnv}`,
        code: 'SOLAPI_ENV_MISSING',
      });
    }

    let txResult;

    try {
      txResult = await prisma.$transaction(
        async (tx) => {
          const appliedCnt = await tx.festivalApplication.count({
            where: {
              appliedLocalDate: parsed.date,
              deletedAt: null,
              status: 'APPLIED',
            },
          });
          if (appliedCnt === 0) {
            return { tag: /** @type {const} */ ('no_apps') };
          }

          const pairingResult = await runFestivalPairing(tx, {
            appliedLocalDate: parsed.date,
          });

          if (pairingResult.tag === 'imbalance') {
            return {
              tag: /** @type {const} */ ('imbalance'),
              validation: pairingResult.validation,
            };
          }

          return { tag: /** @type {const} */ ('ok'), pairingResult };
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

    if (txResult.tag === 'no_apps') {
      return res.status(400).json({
        error: '해당 일자에 매칭할 APPLIED 신청이 없습니다.',
        code: 'FESTIVAL_NO_APPLICATIONS_TO_MATCH',
      });
    }

    if (txResult.tag === 'imbalance') {
      const v = txResult.validation;
      return res.status(400).json({
        error: v.error,
        code: v.code,
        counts: v.counts,
      });
    }

    const runResult = txResult.pairingResult;

    const imgId = await getKakaoFriendTalkImageIdFromEnv(FRIEND_TALK_IMG_MATCH_SUCCESS);
    /** @type {{ phone: string, error: string }[]} */
    const notifyFailures = [];

    for (const p of runResult.pairs) {
      const { male: m, female: f } = p;
      const textM = buildFestivalMatchFriendTalkText(
        { receptionId: m.receptionId, phone: m.phone, vibe: m.vibe },
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
        { receptionId: f.receptionId, phone: f.phone, vibe: f.vibe },
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
      resource: `Festival:${parsed.ymd}`,
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
      pairedCount: runResult.pairedCount,
      unmatchedMale: runResult.unmatchedMale,
      unmatchedFemale: runResult.unmatchedFemale,
      poolCounts: runResult.poolCounts ?? null,
      notifyFailures,
    });
  } catch (err) {
    console.error('admin POST festival/match-run:', err);
    return res.status(500).json({ error: '매칭 처리 중 오류가 발생했습니다.' });
  }
});

/**
 * POST /api/admin/festival/delete
 * Body `{ "phone": "010-xxxx-xxxx" }` — 상태 APPLIED만 소프트 삭제(DROPPED). 친구톡 미발송.
 */
router.post('/festival/delete', adminAuthMiddleware, async (req, res) => {
  try {
    const parsed = parseFestivalAdminPhoneBody(req.body);
    if (!parsed.ok) {
      return res.status(parsed.status).json({ error: parsed.error });
    }

    const found = await findLatestActiveFestivalApplicationByPhone(parsed.phoneNorm);
    if (found.tag === 'not_found') {
      return res.status(404).json({ error: '해당 번호의 축제 신청을 찾을 수 없습니다.' });
    }
    if (found.tag === 'conflict') {
      return res.status(409).json({
        error: `이미 처리된 신청입니다. (status:${found.row.status})`,
        receptionId: found.row.receptionId,
      });
    }

    const now = new Date();
    const updated = await prisma.festivalApplication.update({
      where: { id: found.row.id },
      data: {
        status: 'DROPPED',
        deletedAt: now,
      },
    });

    await writeAccessLog({
      actorType: 'admin',
      actorId: req.admin?.adminId ?? null,
      action: 'FESTIVAL_ADMIN_DELETE',
      resource: `FestivalApplication:${String(updated.id)}`,
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: {
        receptionId: updated.receptionId,
        phoneMasked: `${parsed.phoneNorm.slice(0, 4)}***`,
        notifySent: false,
      },
    });

    return res.status(200).json({
      ok: true,
      receptionId: updated.receptionId,
      status: updated.status,
    });
  } catch (err) {
    console.error('admin festival/delete:', err);
    return res.status(500).json({ error: '삭제 처리 중 오류가 발생했습니다.' });
  }
});

/**
 * POST /api/admin/festival/drop
 * Body `{ "phone": "010-xxxx-xxxx" }` — 상태 APPLIED만 Drop 후 친구톡 알림 후 소프트 삭제.
 */
router.post('/festival/drop', adminAuthMiddleware, async (req, res) => {
  try {
    const parsed = parseFestivalAdminPhoneBody(req.body);
    if (!parsed.ok) {
      return res.status(parsed.status).json({ error: parsed.error });
    }
    const { phoneNorm } = parsed;

    const found = await findLatestActiveFestivalApplicationByPhone(phoneNorm);
    if (found.tag === 'not_found') {
      return res.status(404).json({ error: '해당 번호의 축제 신청을 찾을 수 없습니다.' });
    }
    if (found.tag === 'conflict') {
      return res.status(409).json({
        error: `이미 처리된 신청입니다. (status:${found.row.status})`,
        receptionId: found.row.receptionId,
      });
    }
    const row = found.row;

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
      data: { status: 'DROPPED', deletedAt: now },
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
