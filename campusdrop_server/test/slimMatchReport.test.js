const test = require('node:test');
const assert = require('node:assert/strict');
const { slimMatchReportForDb } = require('../lib/slimMatchReport');

test('slim match report keeps reasons and matched slot', () => {
  const out = slimMatchReportForDb(91.234, {
    reasons_numbered_ko: ['이유1: 설문 기반으로 잘 맞습니다.'],
    batch_match_selection: {
      matched_slot: { date: '2026-04-20', time_slot: '11:00-12:00' },
    },
  });

  assert.deepEqual(out, {
    score: 91.23,
    reasons: ['이유1: 설문 기반으로 잘 맞습니다.'],
    matchedSlot: { date: '2026-04-20', time_slot: '11:00-12:00' },
  });
});
