'use strict';

const crypto = require('crypto');
const { utcToKstSlot, kstWallClockToUtc } = require('./kstMeetingInstant');

/** 생성되는 현장 부스 코드 길이 (숫자만). */
const BOOTH_CODE_LENGTH = 4;

function isFestivalBoothCodeEnabled() {
  return Boolean(String(process.env.FESTIVAL_BOOTH_CODE_SECRET || '').trim());
}

/** 숫자만 추출 후 4자리로 맞춤(입력 `42` → `0042`). 4자 초과 시 끝 4자 사용. */
function normalizeBoothCodeInput(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  const tail = digits.length <= BOOTH_CODE_LENGTH ? digits : digits.slice(-BOOTH_CODE_LENGTH);
  return tail.padStart(BOOTH_CODE_LENGTH, '0').slice(-BOOTH_CODE_LENGTH);
}

/**
 * @param {Buffer} digest SHA-256 HMAC 등 충분한 길이의 다이제스트
 */
function hmacDigestToNumericCode(digest) {
  const use = Math.min(4, digest.length);
  let n = 0;
  for (let i = 0; i < use; i += 1) {
    // JS 비트 시프트는 signed int32 — unsigned로 고정해 음수·`-7343` 형태 방지
    n = ((n << 8) | digest[i]) >>> 0;
  }
  const mod = 10 ** BOOTH_CODE_LENGTH;
  const codeNum = n % mod;
  return String(codeNum).padStart(BOOTH_CODE_LENGTH, '0');
}

/**
 * KST 벽시계 **정시~59분**이 한 버킷. 1시간마다 코드 변경.
 * @param {string} secret
 * @param {Date} now
 */
function computeBoothCodeForInstant(secret, now) {
  const slot = utcToKstSlot(now);
  if (!slot) return null;
  const hh = String(slot.hourStart).padStart(2, '0');
  const payload = `festival-booth-hour|${slot.date}T${hh}`;
  const digest = crypto.createHmac('sha256', secret).update(payload).digest();
  const code = hmacDigestToNumericCode(digest);
  return {
    code,
    slot,
    payloadKey: `${slot.date}T${hh}`,
  };
}

/**
 * @param {Record<string, unknown>} body mood-apply JSON
 * @returns {{ error: string } | null}
 */
function verifyFestivalBoothCodeFromRequestBody(body) {
  const secret = String(process.env.FESTIVAL_BOOTH_CODE_SECRET || '').trim();
  if (!secret) return null;

  const raw = body?.boothCode ?? body?.booth_code;
  const norm = normalizeBoothCodeInput(typeof raw === 'string' ? raw : raw == null ? '' : String(raw));
  if (!norm || norm.length !== BOOTH_CODE_LENGTH) {
    return {
      error: '부스 인증 코드(boothCode)가 필요합니다. 현장 안내된 코드를 입력해 주세요.',
    };
  }

  const cur = computeBoothCodeForInstant(secret, new Date());
  if (!cur) {
    return { error: '부스 코드를 검증할 수 없습니다.' };
  }

  try {
    const a = Buffer.from(norm, 'utf8');
    const b = Buffer.from(cur.code, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return {
        error: '부스 인증 코드가 올바르지 않거나 만료되었습니다. 현장 표시와 동일한지 확인해 주세요.',
      };
    }
  } catch {
    return {
      error: '부스 인증 코드가 올바르지 않거나 만료되었습니다. 현장 표시와 동일한지 확인해 주세요.',
    };
  }

  return null;
}

/** 관리자 화면용: 현재 시간대 코드·유효 구간 */
function getFestivalBoothCodeForAdmin() {
  const secret = String(process.env.FESTIVAL_BOOTH_CODE_SECRET || '').trim();
  const now = new Date();
  const cur = computeBoothCodeForInstant(secret, now);
  if (!cur) {
    throw new Error('BOOTH_CODE_SLOT');
  }
  const startUtc = kstWallClockToUtc(cur.slot.date, cur.slot.hourStart);
  const validFromUtc = startUtc ? startUtc.toISOString() : null;
  const validUntilUtc = startUtc ? new Date(startUtc.getTime() + 60 * 60 * 1000).toISOString() : null;

  return {
    boothCode: cur.code,
    kstDate: cur.slot.date,
    kstHourStart: cur.slot.hourStart,
    kstTimeSlotLabel: cur.slot.time_slot,
    payloadKey: cur.payloadKey,
    validFromUtc,
    validUntilUtc,
    nowUtc: now.toISOString(),
  };
}

module.exports = {
  isFestivalBoothCodeEnabled,
  normalizeBoothCodeInput,
  hmacDigestToNumericCode,
  verifyFestivalBoothCodeFromRequestBody,
  getFestivalBoothCodeForAdmin,
  computeBoothCodeForInstant,
};
