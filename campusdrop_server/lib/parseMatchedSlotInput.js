'use strict';

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateOnly(s) {
  if (typeof s !== 'string' || !DATE_ONLY_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function padHour(h) {
  return String(h).padStart(2, '0');
}

function timeSlotFromHours(hourStart, hourEnd) {
  return `${padHour(hourStart)}:00-${padHour(hourEnd)}:00`;
}

function normalizeAvailableSlot(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const r = /** @type {Record<string, unknown>} */ (row);
  const date = typeof r.date === 'string' ? r.date.trim() : '';
  const hourStart = Number(r.hourStart);
  const hourEnd = Number(r.hourEnd);
  if (!isValidDateOnly(date)) return null;
  if (!Number.isInteger(hourStart) || hourStart < 0 || hourStart > 23) return null;
  if (!Number.isInteger(hourEnd) || hourEnd < 0 || hourEnd > 23) return null;
  const diff = (hourEnd - hourStart + 24) % 24;
  if (diff !== 1) return null;
  return { date, hourStart, hourEnd };
}

function normalizeTimeSlotString(value) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value).trim();
  const m = s.match(/^(\d{1,2})(?::00)?\s*-\s*(\d{1,2})(?::00)?$/);
  if (!m) return null;
  const hourStart = Number(m[1]);
  const hourEnd = Number(m[2]);
  const slot = normalizeAvailableSlot({ date: '2026-01-01', hourStart, hourEnd });
  if (!slot) return null;
  return { hourStart, hourEnd, time_slot: timeSlotFromHours(hourStart, hourEnd) };
}

/**
 * 관리자 강제 매칭 등: `matchedSlot` 본문 파싱. 비어 있으면 `value: null`.
 * @param {unknown} raw
 * @returns {{ ok: true, value: { date: string, hourStart: number, hourEnd: number, time_slot: string } | null } | { ok: false, error: string }}
 */
function parseMatchedSlotInput(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: null };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'matchedSlot은 객체여야 합니다.' };
  }
  const slot = normalizeAvailableSlot(raw);
  if (!slot) {
    return {
      ok: false,
      error:
        'matchedSlot은 { date: YYYY-MM-DD, hourStart: 0~23, hourEnd: 0~23 } 형태의 정확히 1시간 구간이어야 합니다.',
    };
  }

  const row = /** @type {Record<string, unknown>} */ (raw);
  const timeSlot = normalizeTimeSlotString(row.time_slot ?? row.timeSlot);
  if ((row.time_slot !== undefined || row.timeSlot !== undefined) && !timeSlot) {
    return { ok: false, error: 'matchedSlot.time_slot은 "12-13" 또는 "12:00-13:00" 형식이어야 합니다.' };
  }
  if (timeSlot && (timeSlot.hourStart !== slot.hourStart || timeSlot.hourEnd !== slot.hourEnd)) {
    return { ok: false, error: 'matchedSlot.time_slot이 hourStart/hourEnd와 일치하지 않습니다.' };
  }

  return {
    ok: true,
    value: {
      date: slot.date,
      hourStart: slot.hourStart,
      hourEnd: slot.hourEnd,
      time_slot: timeSlotFromHours(slot.hourStart, slot.hourEnd),
    },
  };
}

module.exports = {
  isValidDateOnly,
  normalizeAvailableSlot,
  timeSlotFromHours,
  parseMatchedSlotInput,
};
