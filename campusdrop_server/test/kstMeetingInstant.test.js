const test = require('node:test');
const assert = require('node:assert/strict');

const {
  kstWallClockToUtc,
  hourStartFromTimeSlotString,
  utcToKstSlot,
} = require('../lib/kstMeetingInstant');

test('kstWallClockToUtc: KST 14시 = UTC 05시', () => {
  const d = kstWallClockToUtc('2026-05-15', 14);
  assert.equal(d.toISOString(), '2026-05-15T05:00:00.000Z');
});

test('hourStartFromTimeSlotString: "14:00-15:00" → 14', () => {
  assert.equal(hourStartFromTimeSlotString('14:00-15:00'), 14);
  assert.equal(hourStartFromTimeSlotString('14-15'), 14);
  assert.equal(hourStartFromTimeSlotString('잘못된포맷'), null);
});

test('utcToKstSlot: UTC 05:00Z → KST 2026-05-15 14:00 슬롯', () => {
  const slot = utcToKstSlot(new Date('2026-05-15T05:00:00.000Z'));
  assert.deepEqual(slot, {
    date: '2026-05-15',
    hourStart: 14,
    hourEnd: 15,
    time_slot: '14:00-15:00',
  });
});

test('utcToKstSlot: UTC 자정(00:00Z)은 KST 09시', () => {
  const slot = utcToKstSlot(new Date('2026-05-15T00:00:00.000Z'));
  assert.deepEqual(slot, {
    date: '2026-05-15',
    hourStart: 9,
    hourEnd: 10,
    time_slot: '09:00-10:00',
  });
});

test('utcToKstSlot: 분/초가 있어도 시간 단위로 floor', () => {
  const slot = utcToKstSlot(new Date('2026-05-15T05:42:30.000Z'));
  assert.equal(slot.hourStart, 14);
  assert.equal(slot.time_slot, '14:00-15:00');
});

test('utcToKstSlot: KST 23시 → hourEnd 24가 아니라 0으로 wrap', () => {
  // 23:00 KST = 14:00 UTC
  const slot = utcToKstSlot(new Date('2026-05-15T14:00:00.000Z'));
  assert.equal(slot.hourStart, 23);
  assert.equal(slot.hourEnd, 0);
  assert.equal(slot.time_slot, '23:00-00:00');
});

test('utcToKstSlot: ISO 문자열 입력도 받음', () => {
  const slot = utcToKstSlot('2026-05-15T05:00:00.000Z');
  assert.equal(slot.hourStart, 14);
});

test('utcToKstSlot: 잘못된 입력은 null', () => {
  assert.equal(utcToKstSlot(null), null);
  assert.equal(utcToKstSlot(undefined), null);
  assert.equal(utcToKstSlot('not a date'), null);
});

test('kstWallClockToUtc ↔ utcToKstSlot 역산이 일관된다', () => {
  for (const [date, hour] of [
    ['2026-05-15', 9],
    ['2026-05-15', 14],
    ['2026-05-15', 23],
    ['2026-05-15', 0],
  ]) {
    const utc = kstWallClockToUtc(date, hour);
    const slot = utcToKstSlot(utc);
    assert.equal(slot.date, date);
    assert.equal(slot.hourStart, hour);
  }
});
