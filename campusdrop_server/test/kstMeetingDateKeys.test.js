'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { kstSixMeetingOfferDaysAfterToday, utcBoundsForKstDateKeys } = require('../lib/kstMeetingDateKeys');

test('월요일 KST 기준 다음 날부터 6일 = 화~일', () => {
  const mon = new Date('2026-05-18T09:00:00+09:00');
  assert.deepEqual(kstSixMeetingOfferDaysAfterToday(mon), [
    '2026-05-19',
    '2026-05-20',
    '2026-05-21',
    '2026-05-22',
    '2026-05-23',
    '2026-05-24',
  ]);
});

test('utcBoundsForKstDateKeys covers 서울 자정~말일', () => {
  const keys = new Set(['2026-05-19', '2026-05-24']);
  const { rangeStart, rangeEnd } = utcBoundsForKstDateKeys(keys);
  assert.equal(rangeStart.toISOString(), '2026-05-18T15:00:00.000Z');
  assert.equal(rangeEnd.toISOString(), '2026-05-24T14:59:59.999Z');
});
