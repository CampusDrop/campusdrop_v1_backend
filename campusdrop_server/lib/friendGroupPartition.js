/**
 * 친구 소그룹 매칭(조 크기 3 또는 4만 허용)용 파티션.
 * n명을 겹치지 않는 조로 나눌 때, 조원 수 합을 최대로 한다(남는 인원은 미매칭).
 *
 * DP: dp[i] = i명이 있을 때 조에 넣을 수 있는 최대 인원 수
 * dp[i] = max(dp[i-1], dp[i-3]+3, dp[i-4]+4)
 *
 * 예: n=5 → 한 조 4명 + 1명 미매칭(3+2보다 4+1이 더 많이 매칭됨)
 *
 * @param {number} n
 * @returns {{ matchedCount: number, groupSizes: number[], leftover: number }}
 */
function partitionIntoGroupsOf3Or4(n) {
  const k = Math.floor(Number(n));
  if (!Number.isFinite(k) || k < 0) {
    return { matchedCount: 0, groupSizes: [], leftover: 0 };
  }
  if (k === 0) {
    return { matchedCount: 0, groupSizes: [], leftover: 0 };
  }

  const dp = new Array(k + 1).fill(0);
  for (let i = 1; i <= k; i += 1) {
    let best = dp[i - 1];
    if (i >= 3) {
      best = Math.max(best, dp[i - 3] + 3);
    }
    if (i >= 4) {
      best = Math.max(best, dp[i - 4] + 4);
    }
    dp[i] = best;
  }

  const matchedCount = dp[k];
  const groupSizes = [];
  let i = k;
  while (i > 0) {
    const skip = dp[i - 1];
    const take3 = i >= 3 ? dp[i - 3] + 3 : -1;
    const take4 = i >= 4 ? dp[i - 4] + 4 : -1;
    if (take4 === dp[i]) {
      groupSizes.push(4);
      i -= 4;
    } else if (take3 === dp[i]) {
      groupSizes.push(3);
      i -= 3;
    } else {
      i -= 1;
    }
  }

  groupSizes.sort((a, b) => b - a);
  return {
    matchedCount,
    groupSizes,
    leftover: k - matchedCount,
  };
}

module.exports = {
  partitionIntoGroupsOf3Or4,
};
