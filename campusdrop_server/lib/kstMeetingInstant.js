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

/**
 * UTC `Date` → KST(UTC+9) 벽시계 기준 1시간 슬롯 정보. 분/초는 시간 단위로 floor 됩니다.
 * 관리자 콘솔이 `matchReport.matchedSlot`을 시간대 칸으로 쓰는 흐름에 맞춰
 * `meetingStartsAt` 변경 시 슬롯 메타를 같이 갱신할 때 사용합니다.
 *
 * @param {Date | string | number} input
 * @returns {{ date: string, hourStart: number, hourEnd: number, time_slot: string } | null}
 */
function utcToKstSlot(input) {
  const d = input instanceof Date ? input : input == null ? null : new Date(input);
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  const k = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = k.getUTCFullYear();
  const mm = String(k.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(k.getUTCDate()).padStart(2, '0');
  const hourStart = k.getUTCHours();
  const hourEnd = (hourStart + 1) % 24;
  const time_slot = `${String(hourStart).padStart(2, '0')}:00-${String(hourEnd).padStart(2, '0')}:00`;
  return { date: `${yyyy}-${mm}-${dd}`, hourStart, hourEnd, time_slot };
}

module.exports = { kstWallClockToUtc, hourStartFromTimeSlotString, utcToKstSlot };
