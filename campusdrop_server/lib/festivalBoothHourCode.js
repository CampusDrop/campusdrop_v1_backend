'use strict';

const crypto = require('crypto');
const { utcToKstSlot, kstWallClockToUtc } = require('./kstMeetingInstant');

/** I, O, 0, 1 제외 — 현장 안내·입력 혼동 완화 */
const BOOTH_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function isFestivalBoothCodeEnabled() {
  return Boolean(String(process.env.FESTIVAL_BOOTH_CODE_SECRET || '').trim());
}

/** @param {unknown} raw */
function normalizeBoothCodeInput(raw) {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

/**
 * @param {Buffer} digest min 8 bytes
 */
function hmacDigestToCode6(digest) {
  let n = 0n;
  const use = Math.min(8, digest.length);
  for (let i = 0; i < use; i += 1) {
    n = (n << 8n) | BigInt(digest[i]);
  }
  let out = '';
  const base = BigInt(BOOTH_CODE_ALPHABET.length);
  for (let i = 0; i < 6; i += 1) {
    out += BOOTH_CODE_ALPHABET[Number(n % base)];
    n /= base;
  }
  return out;
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
  const code = hmacDigestToCode6(digest);
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
  if (!norm) {
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
  verifyFestivalBoothCodeFromRequestBody,
  getFestivalBoothCodeForAdmin,
  computeBoothCodeForInstant,
};
