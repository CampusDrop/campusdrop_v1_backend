/**
 * 친구 소그룹 매칭 결정 근거 — 저장·로그 공통 형식(v1).
 * DB 컬럼·그룹 테이블이 붙으면 여기 객체를 그대로 JSON 저장하면 됨.
 */
const FRIEND_MATCH_DECISION_VERSION = /** @type {const} */ (1);

/** @typedef {'GAME_PC'|'EXERCISE'|'CAFE'|'CULTURE'} FriendMainHobby */
/** @typedef {'HOBBY'|'FOOD_FALLBACK'} FriendMatchBucketLane */

/**
 * 알고리즘 스펙 버전 — 운영 중 규칙이 바뀌면 증가.
 * @see friendGroupPartition.partitionIntoGroupsOf3Or4
 */
const ALGO_POLICY_ID = /** @type {const} */ ('min_slot_count_then_earliest__one_group_per_pick__fixed_bucket_order');

/**
 * @typedef {{
 *   version: 1,
 *   algoPolicyId: string,
 *   lane: FriendMatchBucketLane,
 *   mainHobby?: FriendMainHobby,
 *   mainHobbyDetail?: string,
 *   favoriteFood?: string,
 *   slot: { date: string, time_slot: string } | null,
 *   pick: null | {
 *     minAvailableCount: number,
 *     tiesBrokenByEarliestSlot: boolean,
 *     groupSizeChosen: 3 | 4,
 *     applicantOrder: 'submitted_at_asc',
 *   },
 *   outcome: 'MATCHED_ONE_GROUP',
 *   membersBySubmittedAtAsc: Array<{ identityId: string, submittedAt: string }>,
 * }} FriendMatchMatchedDecisionV1
 */

/**
 * @typedef {{
 *   version: 1,
 *   algoPolicyId: string,
 *   lane?: FriendMatchBucketLane | 'POST_HOBBY_REMAINDER',
 *   mainHobby?: FriendMainHobby,
 *   mainHobbyDetail?: string,
 *   favoriteFood?: string,
 *   outcome: string,
 *   detail?: Record<string, unknown>,
 * }} FriendMatchUnmatchedDecisionV1
 */

/**
 * @param {{
 *   lane: FriendMatchBucketLane,
 *   mainHobby?: FriendMainHobby,
 *   mainHobbyDetail?: string,
 *   favoriteFood?: string,
 *   slot: { date: string, time_slot: string } | null,
 *   minAvailableCount?: number | null,
 *   groupSizeChosen: 3 | 4,
 *   membersBySubmittedAtAsc: Array<{ identityId: string, submittedAt: string }>,
 * }} p
 */
function buildFriendMatchMatchedDecisionV1(p) {
  return {
    version: FRIEND_MATCH_DECISION_VERSION,
    algoPolicyId: ALGO_POLICY_ID,
    lane: p.lane,
    mainHobby: p.mainHobby,
    mainHobbyDetail: p.mainHobbyDetail,
    favoriteFood: p.favoriteFood,
    slot: p.slot,
    pick:
      p.minAvailableCount != null && p.slot
        ? {
            minAvailableCount: p.minAvailableCount,
            tiesBrokenByEarliestSlot: true,
            groupSizeChosen: p.groupSizeChosen,
            applicantOrder: /** @type {const} */ ('submitted_at_asc'),
          }
        : null,
    outcome: /** @type {const} */ ('MATCHED_ONE_GROUP'),
    membersBySubmittedAtAsc: p.membersBySubmittedAtAsc,
  };
}

/**
 * @param {{
 *   lane: FriendMatchBucketLane | 'POST_HOBBY_REMAINDER',
 *   code: string,
 *   mainHobby?: FriendMainHobby,
 *   mainHobbyDetail?: string,
 *   favoriteFood?: string,
 *   detail?: Record<string, unknown>,
 * }} p
 */
function buildFriendMatchUnmatchedDecisionV1(p) {
  return {
    version: FRIEND_MATCH_DECISION_VERSION,
    algoPolicyId: ALGO_POLICY_ID,
    lane: p.lane,
    mainHobby: p.mainHobby,
    mainHobbyDetail: p.mainHobbyDetail,
    favoriteFood: p.favoriteFood,
    outcome: p.code,
    detail: p.detail,
  };
}

module.exports = {
  FRIEND_MATCH_DECISION_VERSION,
  ALGO_POLICY_ID,
  buildFriendMatchMatchedDecisionV1,
  buildFriendMatchUnmatchedDecisionV1,
};
