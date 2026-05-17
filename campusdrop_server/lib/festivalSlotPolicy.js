'use strict';

const { utcToKstSlot, kstWallClockToUtc } = require('./kstMeetingInstant');

/**
 * @typedef {{ slot1MatchHour: number, slot2MatchHour: number }} FestivalSlotHours
 */

/**
 * 활성 행 또는 기본값으로 슬롯 시각(KST 벽시계 시) 결정.
 * @param {{ slot1MatchHour?: number | null, slot2MatchHour?: number | null } | null} cfg
 * @returns {FestivalSlotHours}
 */
function resolveSlotHoursFromConfig(cfg) {
  let s1 = Number(cfg?.slot1MatchHour);
  let s2 = Number(cfg?.slot2MatchHour);
  if (!Number.isInteger(s1) || s1 < 0 || s1 > 23) s1 = 14;
  if (!Number.isInteger(s2) || s2 < 0 || s2 > 23) s2 = 17;
  if (s1 === s2) {
    s2 = Math.min(23, s1 + 3);
    if (s2 === s1) s2 = 23;
  }
  return { slot1MatchHour: s1, slot2MatchHour: s2 };
}

/**
 * @param {string} ymd KST yyyy-MM-dd
 * @param {FestivalSlotHours} hours
 */
function slotUtcStarts(ymd, hours) {
  const slot1Utc = kstWallClockToUtc(ymd, hours.slot1MatchHour);
  const slot2Utc = kstWallClockToUtc(ymd, hours.slot2MatchHour);
  return { slot1Utc, slot2Utc };
}

/**
 * 현재 순간 기준 오늘 KST 날짜 문자열
 * @param {Date} nowUtc
 */
function todayKstYmd(nowUtc) {
  const s = utcToKstSlot(nowUtc);
  return s ? s.date : null;
}

/**
 * UTC 순간 기준 해당 KST 달력일의 Postgres DATE에 넣기 좋은 Date (UTC 자정 버전 문자열 매핑)
 * js Date 타임존 이슈를 피하기 위해 날짜 부분 문자열만 사용.
 * @param {string} ymd yyyy-MM-dd
 * @returns {Date}
 */
function dateOnlyFromYmd(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return new Date(NaN);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0));
}

/**
 * 제출 순간(now)에 새 신청은 몇 번 슬롯인지 결정합니다.
 * - KST 같은 날: now < 첫 매칭 시각 → 슬롯 1 | 그후 둘째 매칭 이전까지 → 슬롯 2 | 둘째 이후면 null
 *
 * @param {Date} nowUtc
 * @param {string} todayYmd KST yyyy-mm-dd 오늘
 * @param {FestivalSlotHours} hours
 * @returns {{ slot: 1 | 2, appliedLocalDate: Date } | { slot: null, errorMessage: string } }
 */
function resolveSlotForSubmission(nowUtc, todayYmd, hours) {
  const { slot1Utc, slot2Utc } = slotUtcStarts(todayYmd, hours);
  if (!slot1Utc || !slot2Utc) {
    return { slot: null, errorMessage: '매칭 시각 설정이 올바르지 않습니다.' };
  }
  if (slot2Utc.getTime() <= slot1Utc.getTime()) {
    return { slot: null, errorMessage: '두 번째 슬롯 시각은 첫 슬록보다 늦아야 합니다.' };
  }
  const appliedLocalDate = dateOnlyFromYmd(todayYmd);
  if (nowUtc.getTime() < slot1Utc.getTime()) return { slot: 1, appliedLocalDate };
  if (nowUtc.getTime() < slot2Utc.getTime()) return { slot: 2, appliedLocalDate };
  return { slot: null, errorMessage: '오늘 축제 신청 접수(17시 회차 시작 이전까지) 시간이 종료되었습니다.' };
}

/**
 * GET 표시 규칙: APPLIED 이고 해당 슬롯의 매칭 시각 이후에는 "없음"과 동등 취급.
 *
 * @param {Date} nowUtc
 * @param {Date} appliedLocalDate
 * @param {1 | 2} matchingSlot
 * @param {'APPLIED' | 'MATCHED' | 'DROPPED' | string} status
 * @param {FestivalSlotHours} hours
 */
function applicationVisibleAfterSlotPass(nowUtc, appliedLocalDate, matchingSlot, status, hours) {
  if (status === 'MATCHED' || status === 'DROPPED') return { visible: true };
  const ymd = ymdFromPrismaDateOnly(appliedLocalDate);
  const { slot1Utc, slot2Utc } = slotUtcStarts(ymd, hours);
  if (!slot1Utc || !slot2Utc) return { visible: true };
  if (matchingSlot === 2) {
    if (status === 'APPLIED' && nowUtc.getTime() >= slot2Utc.getTime()) return { visible: false, closedSlot: 2 };
    return { visible: true };
  }
  if (matchingSlot === 1) {
    if (status === 'APPLIED' && nowUtc.getTime() >= slot1Utc.getTime()) return { visible: false, closedSlot: 1 };
    return { visible: true };
  }
  return { visible: true };
}

/**
 * @param {Date} d prisma @db.Date
 * @returns {string} yyyy-mm-dd UTC calendar parts (표준 Date UTC components)
 */
function ymdFromPrismaDateOnly(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return utcToKstSlot(new Date())?.date || '1970-01-01';
  const yyyy = x.getUTCFullYear();
  const mm = String(x.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(x.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

module.exports = {
  resolveSlotHoursFromConfig,
  slotUtcStarts,
  todayKstYmd,
  dateOnlyFromYmd,
  resolveSlotForSubmission,
  applicationVisibleAfterSlotPass,
  ymdFromPrismaDateOnly,
};
