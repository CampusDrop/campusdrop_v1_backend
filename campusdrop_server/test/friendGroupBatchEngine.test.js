const assert = require('node:assert/strict');
const { runFriendGroupBatchPlan, uniqueSlotRefsOfUser } = require('../lib/friendGroupBatchEngine');

const S = {
  /** @returns {{ date: string, time_slot: string }} */
  one() {
    return { date: '2026-06-09', time_slot: '14:00-15:00' };
  },
};

const u1 = '11111111-1111-4111-8111-111111111111';
const u2 = '22222222-2222-4222-8222-222222222222';
const u3 = '33333333-3333-4333-8333-333333333333';

const slot = S.one();

/** @param {string} id @param {string} iso @param {string} food */
function p(id, iso, food) {
  return {
    id,
    submittedAt: iso,
    slots: [slot],
    slotRefs: uniqueSlotRefsOfUser([slot]),
    mainHobby: 'GAME_PC',
    mainHobbyDetail: 'LOL_DUO',
    favoriteFood: food,
  };
}

const r = runFriendGroupBatchPlan({
  participants: [
    p(u1, '2026-06-06T01:00:00.000Z', 'SPICY_BOLD'),
    p(u2, '2026-06-06T02:00:00.000Z', 'SPICY_BOLD'),
    p(u3, '2026-06-06T03:00:00.000Z', 'RICE_HEARTY'),
  ],
  forbiddenPairTuples: [],
});
assert.equal(r.groups.length, 1);
assert.deepEqual(r.groups[0].memberIds.slice().sort(), [u1, u2, u3].slice().sort());

console.log('friendGroupBatchEngine tests ok');
