'use strict';

const { utcToKstSlot, kstWallClockToUtc } = require('./kstMeetingInstant');

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * KST 벽시계 `dateStr` + 시·분 → UTC Date
 * @param {string} dateStr `YYYY-MM-DD`
 * @param {number} hour 0~23
 * @param {number} minute 0~59
 * @returns {Date | null}
 */
function kstYmdHourMinuteToUtc(dateStr, hour, minute) {
  if (typeof dateStr !== 'string' || !DATE_ONLY_RE.test(dateStr)) return null;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour - 9, minute, 0, 0));
}

/**
 * UTC 기준 시각의 KST 달력 날짜·시·분
 * @param {Date} utcDate
 * @returns {{ calendarDate: string, hour: number, minute: number } | null}
 */
function kstWallPartsFromUtc(utcDate) {
  const slot = utcToKstSlot(utcDate);
  if (!slot) return null;
  const k = new Date(utcDate.getTime() + 9 * 60 * 60 * 1000);
  return {
    calendarDate: slot.date,
    hour: k.getUTCHours(),
    minute: k.getUTCMinutes(),
  };
}

/**
 * KST 20:30 **미만**이면 true (20:29까지 true, 20:30부터 false)
 * @param {Date} utcDate
 */
function isKstStrictlyBefore2030(utcDate) {
  const p = kstWallPartsFromUtc(utcDate);
  if (!p) return true;
  if (p.hour < 20) return true;
  if (p.hour === 20 && p.minute < 30) return true;
  return false;
}

/**
 * KST `calendarYmd` 다음 날 `YYYY-MM-DD`
 * @param {string} calendarYmd
 * @returns {string | null}
 */
function nextKstCalendarDateYmd(calendarYmd) {
  if (typeof calendarYmd !== 'string' || !DATE_ONLY_RE.test(calendarYmd)) return null;
  const [y, m, d] = calendarYmd.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d, 15, 0, 0);
  const next = new Date(t + 86400000);
  const nk = new Date(next.getTime() + 9 * 60 * 60 * 1000);
  const yy = nk.getUTCFullYear();
  const mm = String(nk.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(nk.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * 확정 시각(KST)이 20:30 이전이면 즉시 발송, 이후면 **익일 KST 08:01** UTC
 * @param {Date} utcResolvedAt
 * @returns {{ mode: 'immediate' } | { mode: 'scheduled', scheduledAt: Date }}
 */
function matchSuccessSendPlanFromResolvedAt(utcResolvedAt) {
  if (!(utcResolvedAt instanceof Date) || Number.isNaN(utcResolvedAt.getTime())) {
    return { mode: 'immediate' };
  }
  if (isKstStrictlyBefore2030(utcResolvedAt)) {
    return { mode: 'immediate' };
  }
  const p = kstWallPartsFromUtc(utcResolvedAt);
  if (!p) {
    return { mode: 'immediate' };
  }
  const nextYmd = nextKstCalendarDateYmd(p.calendarDate);
  if (!nextYmd) {
    return { mode: 'immediate' };
  }
  const scheduledAt = kstYmdHourMinuteToUtc(nextYmd, 8, 1);
  if (!scheduledAt) {
    return { mode: 'immediate' };
  }
  return { mode: 'scheduled', scheduledAt };
}

/**
 * 초대 발송 시점 기준 **당일 KST 23:00** 마감 시각(UTC)
 * @param {Date} utcNow
 * @returns {Date | null}
 */
function attendanceDeadlineUtcForInviteDay(utcNow) {
  const slot = utcToKstSlot(utcNow);
  if (!slot) return null;
  return kstWallClockToUtc(slot.date, 23);
}

module.exports = {
  kstYmdHourMinuteToUtc,
  kstWallPartsFromUtc,
  isKstStrictlyBefore2030,
  nextKstCalendarDateYmd,
  matchSuccessSendPlanFromResolvedAt,
  attendanceDeadlineUtcForInviteDay,
};
