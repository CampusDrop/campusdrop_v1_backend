'use strict';

const jwt = require('jsonwebtoken');

const QR_ISS = 'campusdrop-meet-chat';

function meetChatQrSecret() {
  const s = (process.env.MEET_CHAT_QR_SECRET || '').trim();
  return s.length > 0 ? s : null;
}

/**
 * QR/딥링크용 토큰. `matchingId`만 담고 서명으로 위조를 막습니다.
 * @param {string} matchingId
 * @param {{ expiresIn?: string }} [opts]
 * @returns {string | null} 시크릿 없으면 null
 */
function signMeetChatQrToken(matchingId, opts = {}) {
  const secret = meetChatQrSecret();
  if (!secret) return null;
  const expiresIn = opts.expiresIn || '365d';
  return jwt.sign({ m: matchingId, iss: QR_ISS }, secret, { algorithm: 'HS256', expiresIn });
}

/**
 * @param {string} token
 * @returns {{ matchingId: string } | null}
 */
function verifyMeetChatQrToken(token) {
  const secret = meetChatQrSecret();
  if (!secret || typeof token !== 'string' || token.trim() === '') return null;
  try {
    const p = jwt.verify(token.trim(), secret, { algorithms: ['HS256'] });
    if (p === null || typeof p !== 'object' || Array.isArray(p)) return null;
    const mid = /** @type {Record<string, unknown>} */ (p).m;
    if (typeof mid !== 'string' || mid.length === 0) return null;
    return { matchingId: mid };
  } catch (_) {
    return null;
  }
}

module.exports = { signMeetChatQrToken, verifyMeetChatQrToken, meetChatQrSecret };
