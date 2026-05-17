const assert = require('node:assert/strict');
const { partitionIntoGroupsOf3Or4 } = require('../lib/friendGroupPartition');

function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

const cases = [
  [0, 0, []],
  [1, 0, []],
  [2, 0, []],
  [3, 3, [3]],
  [4, 4, [4]],
  [5, 4, [4]],
  [6, 6, [3, 3]],
  [7, 7, [4, 3]],
  [8, 8, [4, 4]],
  [10, 10, [4, 3, 3]],
];

for (const [n, wantMatched, wantSizes] of cases) {
  const r = partitionIntoGroupsOf3Or4(n);
  assert.equal(
    r.matchedCount,
    wantMatched,
    `n=${n} matchedCount want ${wantMatched} got ${r.matchedCount}`,
  );
  assert.deepEqual(r.groupSizes, wantSizes);
  assert.equal(sum(r.groupSizes), r.matchedCount);
  assert.equal(r.leftover, n - r.matchedCount);
}

const rBad = partitionIntoGroupsOf3Or4(-1);
assert.equal(rBad.matchedCount, 0);
assert.deepEqual(rBad.groupSizes, []);

console.log('friendGroupPartition tests ok');
