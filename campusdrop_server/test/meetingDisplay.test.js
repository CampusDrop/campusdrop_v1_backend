const test = require('node:test');
const assert = require('node:assert/strict');
const { formatMeetingStartsAtKst } = require('../lib/meetingDisplay');

test('formatMeetingStartsAtKst returns null for empty input', () => {
  assert.equal(formatMeetingStartsAtKst(null), null);
  assert.equal(formatMeetingStartsAtKst(undefined), null);
  assert.equal(formatMeetingStartsAtKst(''), null);
});

test('formatMeetingStartsAtKst formats afternoon slot in Korean (KST)', () => {
  // 2026-05-15 14:00 KST == 2026-05-15 05:00 UTC
  const date = new Date('2026-05-15T05:00:00.000Z');
  assert.equal(formatMeetingStartsAtKst(date), '2026년 5월 15일 (금) 오후 2시');
});

test('formatMeetingStartsAtKst formats morning slot', () => {
  // 2026-05-16 11:00 KST == 2026-05-16 02:00 UTC, 토요일
  const date = new Date('2026-05-16T02:00:00.000Z');
  assert.equal(formatMeetingStartsAtKst(date), '2026년 5월 16일 (토) 오전 11시');
});

test('formatMeetingStartsAtKst formats noon as 오후 12시', () => {
  // 2026-05-15 12:00 KST == 2026-05-15 03:00 UTC, 금
  const date = new Date('2026-05-15T03:00:00.000Z');
  assert.equal(formatMeetingStartsAtKst(date), '2026년 5월 15일 (금) 오후 12시');
});

test('formatMeetingStartsAtKst formats midnight as 오전 12시', () => {
  // 2026-05-15 00:00 KST == 2026-05-14 15:00 UTC
  const date = new Date('2026-05-14T15:00:00.000Z');
  assert.equal(formatMeetingStartsAtKst(date), '2026년 5월 15일 (금) 오전 12시');
});

test('formatMeetingStartsAtKst accepts ISO string input', () => {
  assert.equal(
    formatMeetingStartsAtKst('2026-05-15T05:00:00.000Z'),
    '2026년 5월 15일 (금) 오후 2시',
  );
});
