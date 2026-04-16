const test = require('node:test');
const assert = require('node:assert/strict');
const {
  availabilityOverlapCount,
  availabilityPairCompatibleForMatching,
} = require('../lib/availabilityOverlap');

test('different days → no overlap', () => {
  const a = [{ date: '2026-04-20', time_slot: '11:00-12:00' }];
  const b = [{ date: '2026-04-21', time_slot: '11:00-12:00' }];
  assert.equal(availabilityOverlapCount(a, b), 0);
  assert.equal(availabilityPairCompatibleForMatching(a, b), false);
});

test('same slot → overlap', () => {
  const s = { date: '2026-04-20', time_slot: '11:00-12:00' };
  assert.equal(availabilityOverlapCount([s], [{ ...s }]), 1);
  assert.equal(availabilityPairCompatibleForMatching([s], [{ ...s }]), true);
});

test('duplicates collapse for overlap count', () => {
  const a = [
    { date: '2026-04-20', time_slot: '11:00-12:00' },
    { date: '2026-04-20', time_slot: '11:00-12:00' },
  ];
  const b = [{ date: '2026-04-20', time_slot: '11:00-12:00' }];
  assert.equal(availabilityOverlapCount(a, b), 1);
});

test('both empty → compatible (legacy)', () => {
  assert.equal(availabilityPairCompatibleForMatching([], []), true);
});

test('one empty → incompatible', () => {
  const a = [{ date: '2026-04-20', time_slot: '11:00-12:00' }];
  assert.equal(availabilityPairCompatibleForMatching(a, []), false);
  assert.equal(availabilityPairCompatibleForMatching([], a), false);
});

test('midnight spanning slot — string equality', () => {
  const s = { date: '2026-04-20', time_slot: '23:00-00:00' };
  assert.equal(availabilityOverlapCount([s], [{ ...s }]), 1);
});
