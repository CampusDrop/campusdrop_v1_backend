'use strict';

const { kstWallClockToUtc, hourStartFromTimeSlotString } = require('./kstMeetingInstant');

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `matchings.match_report` / 강제매칭 JSON에서 소개팅 시작 시각을 유도합니다.
 * 우선순위: `matchedSlot.hourStart` | `matchedSlot.time_slot`의 시작 시 | 없으면 null.
 *
 * @param {unknown} matchReport
 * @returns {Date | null}
 */
function meetingStartsAtFromMatchReport(matchReport) {
  if (matchReport === null || matchReport === undefined || typeof matchReport !== 'object' || Array.isArray(matchReport)) {
    return null;
  }
  const mr = /** @type {Record<string, unknown>} */ (matchReport);
  const slot = mr.matchedSlot;
  if (slot === null || slot === undefined || typeof slot !== 'object' || Array.isArray(slot)) {
    return null;
  }
  const s = /** @type {Record<string, unknown>} */ (slot);
  const date = typeof s.date === 'string' ? s.date.trim() : '';
  if (!DATE_ONLY_RE.test(date)) return null;

  let hourStart = Number(s.hourStart);
  if (!Number.isInteger(hourStart) || hourStart < 0 || hourStart > 23) {
    const ts = typeof s.time_slot === 'string' ? s.time_slot : typeof s.timeSlot === 'string' ? s.timeSlot : '';
    const parsed = hourStartFromTimeSlotString(ts);
    if (parsed === null) return null;
    hourStart = parsed;
  }

  return kstWallClockToUtc(date, hourStart);
}

/**
 * DB 행 기준: 명시 `meetingStartsAt` 우선, 없으면 `matchReport`에서 유도.
 *
 * @param {{ meetingStartsAt?: Date | null, matchReport?: unknown }} row
 * @returns {Date | null}
 */
function resolveMeetingStartsAt(row) {
  if (!row) return null;
  if (row.meetingStartsAt instanceof Date && !Number.isNaN(row.meetingStartsAt.getTime())) {
    return row.meetingStartsAt;
  }
  return meetingStartsAtFromMatchReport(row.matchReport);
}

module.exports = { meetingStartsAtFromMatchReport, resolveMeetingStartsAt };
