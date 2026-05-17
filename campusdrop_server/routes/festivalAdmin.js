const express = require('express');
const { adminAuthMiddleware } = require('../lib/adminAuth');
const { prisma } = require('../lib/prisma');
const { normalizeKoMobile } = require('../lib/festivalPhone');
const { assertSolapiFriendTalkEnv, sendFriendTalkCta } = require('../lib/solapiFriendTalkSend');
const { writeAccessLog } = require('../lib/accessLog');

const router = express.Router();

function festivalDropFriendTalkText() {
  const raw = String(process.env.FESTIVAL_DROP_FRIENDTALK_TEXT || '').trim();
  if (raw) return raw.slice(0, 1000);
  return `[축제 매칭] 안내 연락드립니다.

이번 축제 매칭은 아쉽게도 포함되기 어려운 상태예요.
자세한 내용은 카카오 채널 등 안내 페이지를 통해 확인 부탁드립니다.

감사합니다.`;
}

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
          userId: true,
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
          userId: true,
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
