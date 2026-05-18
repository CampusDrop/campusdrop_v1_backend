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
  ymdFromPrismaDateOnly,
};
