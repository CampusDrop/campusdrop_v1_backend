'use strict';

const { hourStartFromTimeSlotString } = require('./kstMeetingInstant');

/**
 * `weeklyBatchMatch` 등에서 사용하는 슬롯 키. matchReport.matchedSlot이 없으면 null.
 *
 * @param {{ matchReport?: unknown } | null | undefined} row
 * @returns {string | null}
 */
function slotKeyFromInsertRow(row) {
  if (!row || typeof row !== 'object') return null;
  const mr = /** @type {Record<string, unknown>} */ (row).matchReport;
  if (mr === null || mr === undefined || typeof mr !== 'object' || Array.isArray(mr)) return null;
  const slot = /** @type {Record<string, unknown>} */ (mr).matchedSlot;
  if (slot === null || slot === undefined || typeof slot !== 'object' || Array.isArray(slot)) return null;
  const s = /** @type {Record<string, unknown>} */ (slot);
  const date = typeof s.date === 'string' ? s.date.trim() : '';
  const timeSlot =
    typeof s.time_slot === 'string'
      ? s.time_slot.trim()
      : typeof s.timeSlot === 'string'
        ? s.timeSlot.trim()
        : '';
  if (!date) return null;
  const hour = hourStartFromTimeSlotString(timeSlot);
  if (hour === null) return null;
  return `${date}|${hour}`;
}

/**
 * 슬롯별로 카페를 라운드로빈 배정합니다.
 *
 * - 같은 (date, hourStart) 슬롯에 모인 매칭은 score desc 기준으로 정렬 후
 *   `cafes[i % cafes.length]`로 카페를 배정합니다.
 * - `matchedSlot`이 없는(시간 미정) 행은 카페도 미배정(NULL) 상태로 둡니다 — 관리자가 수동 지정.
 * - 활성 카페가 0개면 변경 없음.
 *
 * 입력 행은 `cafeId`/`meetingVenueName`이 추가/수정되어 in-place 반환됩니다.
 *
 * @template {{ score: number, matchReport?: unknown }} Row
 * @param {Row[]} rows  weeklyBatchMatch에서 만들 prisma create payload 배열
 * @param {Array<{ id: string, name: string }>} cafes  displayOrder 정렬된 활성 카페
 * @returns {Row[]} 같은 배열(변경 후)
 */
function assignCafesToPairs(rows, cafes) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  if (!Array.isArray(cafes) || cafes.length === 0) return rows;

  /** @type {Map<string, Row[]>} */
  const groups = new Map();
  for (const row of rows) {
    const key = slotKeyFromInsertRow(row);
    if (!key) continue;
    const arr = groups.get(key);
    if (arr) {
      arr.push(row);
    } else {
      groups.set(key, [row]);
    }
  }

  for (const arr of groups.values()) {
    arr.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
    for (let i = 0; i < arr.length; i += 1) {
      const cafe = cafes[i % cafes.length];
      arr[i].cafeId = cafe.id;
      arr[i].meetingVenueName = cafe.name;
    }
  }

  return rows;
}

/**
 * `friend_group` 배치 결과용. 각 row에 미리 채워 둔 `slotKey`(예 `2026-06-09|14`) 기준 라운드로빈.
 *
 * @template {{ slotKey?: string | null, score?: number }}
 * @param {unknown[]} rows
 * @param {Array<{ id: string, name: string }>} cafes
 */
function assignCafesToFriendGroupRows(rows, cafes) {
  if (!Array.isArray(rows) || rows.length === 0 || !Array.isArray(cafes) || cafes.length === 0) return rows;

  /** @type {Map<string, any[]>} */
  const groups = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const key = typeof /** @type {Record<string, unknown>} */ (row).slotKey === 'string'
      ? String(/** @type {Record<string, unknown>} */ (row).slotKey || '').trim()
      : '';
    if (!key) continue;
    const arr = groups.get(key);
    if (arr) {
      arr.push(row);
    } else {
      groups.set(key, [row]);
    }
  }

  for (const arr of groups.values()) {
    arr.sort((a, b) => {
      const sa = typeof /** @type {Record<string, unknown>} */ (a).score === 'number' ? /** @type {Record<string, unknown>} */ (a).score : 0;
      const sb = typeof /** @type {Record<string, unknown>} */ (b).score === 'number' ? /** @type {Record<string, unknown>} */ (b).score : 0;
      return sb - sa;
    });
    for (let i = 0; i < arr.length; i += 1) {
      const cafe = cafes[i % cafes.length];
      /** @type {Record<string, unknown>} */
      const r = arr[i];
      r.cafeId = cafe.id;
      r.meetingVenueName = cafe.name;
    }
  }

  return rows;
}

module.exports = {
  assignCafesToPairs,
  assignCafesToFriendGroupRows,
  slotKeyFromInsertRow,
};
