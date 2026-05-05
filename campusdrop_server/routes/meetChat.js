'use strict';

const express = require('express');
const { prisma } = require('../lib/prisma');
const { requireUserUuid } = require('../lib/requireUserUuid');
const { verifyMeetChatQrToken, meetChatQrSecret, signMeetChatQrToken } = require('../lib/meetChatQr');
const { resolveMeetingStartsAt } = require('../lib/meetingStartsAtDerive');
const { getChatWindow, isWithinUserChatWindow, formatMeetChatRoomTitle } = require('../lib/meetChatRoom');
const { findUserMatchingInPeriod, getMatchingPeriodStart } = require('../lib/matchPolicy');

const router = express.Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_BODY_LEN = 2000;
const PAGE_SIZE_CAP = 100;

function isUuid(s) {
  return typeof s === 'string' && UUID_RE.test(s);
}

function qrDisabledResponse(res) {
  return res.status(503).json({
    error: '소개팅 채팅(QR) 기능이 설정되지 않았습니다. MEET_CHAT_QR_SECRET을 구성해 주세요.',
  });
}

/**
 * @param {import('express').Request} req
 */
function rawQrFromReq(req) {
  const q = req.query.qr ?? req.query.token;
  if (typeof q === 'string' && q.trim() !== '') return q.trim();
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    const b = /** @type {Record<string, unknown>} */ (req.body);
    const t = b.qr ?? b.token;
    if (typeof t === 'string' && t.trim() !== '') return t.trim();
  }
  return '';
}

/**
 * @openapi
 * /api/meet-chat/access:
 *   get:
 *     tags: [MeetChat]
 *     summary: QR 토큰·소개팅 일정·채팅 시간대 여부 확인
 *     security:
 *       - UserUuidAuth: []
 */
router.get('/access', requireUserUuid, async (req, res) => {
  if (!meetChatQrSecret()) {
    return qrDisabledResponse(res);
  }

  const matchingIdRaw = req.query.matchingId ?? req.query.matching_id;
  const matchingId = typeof matchingIdRaw === 'string' ? matchingIdRaw.trim() : '';
  const qr = rawQrFromReq(req);

  if (!isUuid(matchingId)) {
    return res.status(400).json({ error: 'matchingId는 유효한 UUID여야 합니다.' });
  }

  const verified = verifyMeetChatQrToken(qr);
  if (!verified || verified.matchingId !== matchingId) {
    return res.status(403).json({ error: 'QR 토큰이 유효하지 않습니다.' });
  }

  const uid = req.user.id;
  let row;
  try {
    row = await prisma.matching.findUnique({
      where: { id: matchingId },
      select: {
        id: true,
        userAId: true,
        userBId: true,
        meetingStartsAt: true,
        meetingVenueName: true,
        matchReport: true,
      },
    });
  } catch (err) {
    console.error('meetChat /access load:', err);
    return res.status(500).json({ error: '매칭 정보를 불러오지 못했습니다.' });
  }

  if (!row) {
    return res.status(404).json({ error: '매칭을 찾을 수 없습니다.' });
  }

  if (row.userAId !== uid && row.userBId !== uid) {
    return res.status(403).json({ error: '이 소개팅 채팅에 참여한 유저가 아닙니다.' });
  }

  const meetingAt = resolveMeetingStartsAt(row);
  const now = new Date();

  if (!meetingAt) {
    return res.status(200).json({
      redirectToLanding: true,
      reason: 'meeting_not_configured',
      matchingId: row.id,
    });
  }

  const { windowOpen, windowEnd } = getChatWindow(meetingAt);
  const roomTitle = formatMeetChatRoomTitle(meetingAt, row.meetingVenueName || '');
  const inWindow = isWithinUserChatWindow(now, meetingAt);

  return res.status(200).json({
    redirectToLanding: !inWindow,
    reason: inWindow ? null : 'outside_chat_window',
    matchingId: row.id,
    roomTitle,
    meetingStartsAt: meetingAt.toISOString(),
    chatWindowOpen: windowOpen.toISOString(),
    chatWindowEnd: windowEnd.toISOString(),
    canUseChat: inWindow,
  });
});

/**
 * @openapi
 * /api/meet-chat/my-qr-token:
 *   get:
 *     tags: [MeetChat]
 *     summary: 로그인 유저 본인 매칭용 채팅 QR JWT 발급
 *     description: |
 *       물리 QR 없이 앱에서 `/meet/chat` 등으로 진입할 때 사용합니다.
 *       `matchingId` 생략 시 이번 매칭 운영 주(`getMatchingPeriodStart`) 기준 본인 짝 1건에 대해 발급합니다.
 *       이때 짝이 없으면 200·`hasMatching: false`·`qrToken` null (에러 아님).
 *       `matchingId` 지정 시 해당 매칭의 참가자(A/B)인 경우에만 발급합니다.
 *     security:
 *       - UserUuidAuth: []
 */
router.get('/my-qr-token', requireUserUuid, async (req, res) => {
  if (!meetChatQrSecret()) {
    return qrDisabledResponse(res);
  }

  const uid = req.user.id;
  const midRaw = req.query.matchingId ?? req.query.matching_id;
  const midOpt = typeof midRaw === 'string' ? midRaw.trim() : '';

  /** @type {{ id: string } | null} */
  let row = null;
  /** @type {string} */
  let matchingId;

  if (midOpt) {
    if (!isUuid(midOpt)) {
      return res.status(400).json({ error: 'matchingId는 유효한 UUID여야 합니다.' });
    }
    try {
      row = await prisma.matching.findUnique({
        where: { id: midOpt },
        select: { id: true, userAId: true, userBId: true },
      });
    } catch (err) {
      console.error('meetChat /my-qr-token load:', err);
      return res.status(500).json({ error: '매칭 정보를 불러오지 못했습니다.' });
    }
    if (!row) {
      return res.status(404).json({ error: '매칭을 찾을 수 없습니다.' });
    }
    if (row.userAId !== uid && row.userBId !== uid) {
      return res.status(403).json({ error: '이 매칭의 참가자가 아닙니다.' });
    }
    matchingId = row.id;
  } else {
    const periodStart = getMatchingPeriodStart();
    try {
      row = await findUserMatchingInPeriod(prisma, uid, periodStart);
    } catch (err) {
      console.error('meetChat /my-qr-token period match:', err);
      return res.status(500).json({ error: '매칭 정보를 불러오지 못했습니다.' });
    }
    if (!row) {
      return res.status(200).json({
        hasMatching: false,
        matchingId: null,
        qrToken: null,
      });
    }
    matchingId = row.id;
  }

  const qrToken = signMeetChatQrToken(matchingId);
  if (!qrToken) {
    return res.status(503).json({ error: 'QR 토큰을 생성하지 못했습니다.' });
  }

  return res.status(200).json({
    hasMatching: true,
    matchingId,
    qrToken,
  });
});

/**
 * 유저·QR·시간대 검증 후 매칭 행과 소개팅 시각을 돌려줍니다.
 * @param {string} matchingId
 * @param {string} userId
 * @param {string} qr
 */
async function assertUserMeetChatSession(matchingId, userId, qr) {
  const verified = verifyMeetChatQrToken(qr);
  if (!verified || verified.matchingId !== matchingId) {
    return { ok: false, status: 403, body: { error: 'QR 토큰이 유효하지 않습니다.' } };
  }

  const row = await prisma.matching.findUnique({
    where: { id: matchingId },
    select: {
      id: true,
      userAId: true,
      userBId: true,
      meetingStartsAt: true,
      meetingVenueName: true,
      matchReport: true,
    },
  });

  if (!row) {
    return { ok: false, status: 404, body: { error: '매칭을 찾을 수 없습니다.' } };
  }
  if (row.userAId !== userId && row.userBId !== userId) {
    return { ok: false, status: 403, body: { error: '이 소개팅 채팅에 참여한 유저가 아닙니다.' } };
  }

  const meetingAt = resolveMeetingStartsAt(row);
  if (!meetingAt) {
    return { ok: false, status: 403, body: { error: '소개팅 일정이 아직 설정되지 않았습니다.' } };
  }
  if (!isWithinUserChatWindow(new Date(), meetingAt)) {
    return { ok: false, status: 403, body: { error: '채팅 가능 시간이 아닙니다.' } };
  }

  return { ok: true, row, meetingAt };
}

/**
 * @openapi
 * /api/meet-chat/{matchingId}/messages:
 *   get:
 *     tags: [MeetChat]
 *     summary: 채팅 메시지 목록 (채팅 시간대 + QR + 참가자만)
 *     security:
 *       - UserUuidAuth: []
 */
router.get('/:matchingId/messages', requireUserUuid, async (req, res) => {
  if (!meetChatQrSecret()) {
    return qrDisabledResponse(res);
  }

  const { matchingId } = req.params;
  if (!isUuid(matchingId)) {
    return res.status(400).json({ error: 'matchingId는 유효한 UUID여야 합니다.' });
  }

  const qr = rawQrFromReq(req);
  if (!qr) {
    return res.status(400).json({ error: 'qr(또는 token)이 필요합니다.' });
  }

  const session = await assertUserMeetChatSession(matchingId, req.user.id, qr);
  if (!session.ok) {
    return res.status(session.status).json(session.body);
  }

  let limit = Number(req.query.limit);
  if (!Number.isFinite(limit)) limit = 50;
  limit = Math.min(Math.max(Math.trunc(limit), 1), PAGE_SIZE_CAP);

  const afterRaw = req.query.after;
  /** @type {any} */
  const where = { matchingId };
  if (typeof afterRaw === 'string' && afterRaw.trim() !== '') {
    const d = new Date(afterRaw.trim());
    if (!Number.isNaN(d.getTime())) {
      where.createdAt = { gt: d };
    }
  }

  try {
    const items = await prisma.meetingChatMessage.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: {
        id: true,
        senderId: true,
        body: true,
        createdAt: true,
      },
    });

    return res.status(200).json({
      matchingId,
      roomTitle: formatMeetChatRoomTitle(session.meetingAt, session.row.meetingVenueName || ''),
      messages: items.map((m) => ({
        id: m.id,
        senderId: m.senderId,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
        mine: m.senderId === req.user.id,
      })),
    });
  } catch (err) {
    console.error('meetChat GET messages:', err);
    return res.status(500).json({ error: '메시지를 불러오지 못했습니다.' });
  }
});

/**
 * @openapi
 * /api/meet-chat/{matchingId}/messages:
 *   post:
 *     tags: [MeetChat]
 *     summary: 채팅 메시지 전송
 *     security:
 *       - UserUuidAuth: []
 */
router.post('/:matchingId/messages', requireUserUuid, async (req, res) => {
  if (!meetChatQrSecret()) {
    return qrDisabledResponse(res);
  }

  const { matchingId } = req.params;
  if (!isUuid(matchingId)) {
    return res.status(400).json({ error: 'matchingId는 유효한 UUID여야 합니다.' });
  }

  const qr = rawQrFromReq(req);
  if (!qr) {
    return res.status(400).json({ error: 'qr(또는 token)이 필요합니다.' });
  }

  const session = await assertUserMeetChatSession(matchingId, req.user.id, qr);
  if (!session.ok) {
    return res.status(session.status).json(session.body);
  }

  const bodyRaw =
    req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? /** @type {Record<string, unknown>} */ (req.body).body
      : undefined;
  const text = typeof bodyRaw === 'string' ? bodyRaw.trim() : '';
  if (text.length === 0) {
    return res.status(400).json({ error: '메시지 내용이 비어 있습니다.' });
  }
  if (text.length > MAX_BODY_LEN) {
    return res.status(400).json({ error: `메시지는 ${MAX_BODY_LEN}자 이하여야 합니다.` });
  }

  try {
    const created = await prisma.meetingChatMessage.create({
      data: {
        matchingId,
        senderId: req.user.id,
        body: text,
      },
      select: { id: true, senderId: true, body: true, createdAt: true },
    });

    return res.status(201).json({
      message: {
        id: created.id,
        senderId: created.senderId,
        body: created.body,
        createdAt: created.createdAt.toISOString(),
        mine: true,
      },
    });
  } catch (err) {
    console.error('meetChat POST messages:', err);
    return res.status(500).json({ error: '메시지를 저장하지 못했습니다.' });
  }
});

module.exports = router;
