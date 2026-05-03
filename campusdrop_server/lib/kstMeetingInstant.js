'use strict';

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * KST는 DST 없음(항상 UTC+9). 벽시계 `dateStr`의 `hour`(0~23) 정각을 UTC `Date`로 변환합니다.
 * @param {string} dateStr `YYYY-MM-DD`
 * @param {number} hour 0~23
 * @returns {Date | null}
 */
function kstWallClockToUtc(dateStr, hour) {
  if (typeof dateStr !== 'string' || !DATE_ONLY_RE.test(dateStr)) return null;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour - 9, 0, 0, 0));
}

/**
 * `"16:00-17:00"` 또는 `"16-17"` 형태에서 시작 시각(0~23)을 파싱합니다.
 * @param {string} timeSlot
 * @returns {number | null}
 */
function hourStartFromTimeSlotString(timeSlot) {
  if (typeof timeSlot !== 'string') return null;
  const s = timeSlot.trim();
  const m = s.match(/^(\d{1,2})(?::00)?(?:\s*-\s*\d{1,2}(?::00)?)?$/);
  if (!m) return null;
  const h = Number(m[1]);
  if (!Number.isInteger(h) || h < 0 || h > 23) return null;
  return h;
}

module.exports = { kstWallClockToUtc, hourStartFromTimeSlotString };
