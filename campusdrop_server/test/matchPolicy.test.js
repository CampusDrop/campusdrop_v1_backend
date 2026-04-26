const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MATCHING_PERIOD_ANCHOR_ISO,
  getMatchingPeriodStart,
  getMatchingPeriodEnd,
} = require('../lib/matchPolicy');

test('matching period starts on Tuesday 00:00 KST', () => {
  assert.equal(MATCHING_PERIOD_ANCHOR_ISO, '2026-04-14T00:00:00.000+09:00');

  const mondayNight = new Date('2026-04-20T23:59:59.000+09:00');
  const tuesdayStart = new Date('2026-04-21T00:00:00.000+09:00');

  assert.equal(getMatchingPeriodStart(mondayNight).toISOString(), '2026-04-13T15:00:00.000Z');
  assert.equal(getMatchingPeriodStart(tuesdayStart).toISOString(), '2026-04-20T15:00:00.000Z');
  assert.equal(
    getMatchingPeriodEnd(getMatchingPeriodStart(tuesdayStart)).toISOString(),
    '2026-04-27T15:00:00.000Z',
  );
});
