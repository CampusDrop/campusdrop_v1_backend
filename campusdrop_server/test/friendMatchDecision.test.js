const assert = require('node:assert/strict');
const {
  ALGO_POLICY_ID,
  buildFriendMatchMatchedDecisionV1,
  buildFriendMatchUnmatchedDecisionV1,
} = require('../lib/friendMatchDecision');

const matched = buildFriendMatchMatchedDecisionV1({
  lane: 'HOBBY',
  mainHobby: 'GAME_PC',
  mainHobbyDetail: 'LOL_DUO',
  slot: { date: '2026-06-08', time_slot: '1500_1600' },
  minAvailableCount: 3,
  groupSizeChosen: 3,
  membersBySubmittedAtAsc: [
    { identityId: 'a'.repeat(32), submittedAt: '2026-06-06T01:00:00.000Z' },
    { identityId: 'b'.repeat(32), submittedAt: '2026-06-06T02:00:00.000Z' },
    { identityId: 'c'.repeat(32), submittedAt: '2026-06-06T03:00:00.000Z' },
  ],
});
assert.equal(matched.version, 1);
assert.equal(matched.algoPolicyId, ALGO_POLICY_ID);
assert.equal(matched.outcome, 'MATCHED_ONE_GROUP');
JSON.stringify(matched);

const um = buildFriendMatchUnmatchedDecisionV1({
  lane: 'FOOD_FALLBACK',
  code: 'NO_SLOT_WITH_MINIMUM_THREE_AFTER_HOBBY_AND_FOOD_PASS',
});
assert.equal(um.outcome, 'NO_SLOT_WITH_MINIMUM_THREE_AFTER_HOBBY_AND_FOOD_PASS');

console.log('friendMatchDecision tests ok');
