from __future__ import annotations

from app.matching import compute_match
from app.schemas import BatchMatchPair, BatchMatchRequest, BatchMatchResponse, LifestyleUser


def run_batch_greedy_unique_pairs(users: list[tuple[str, LifestyleUser]]) -> list[BatchMatchPair]:
    """
    모든 쌍의 매칭 점수를 한 번에 계산한 뒤, 점수 내림차순 그리디로 최대 1:1 배정(유저당 최대 한 번 등장).
    """
    n = len(users)
    if n < 2:
        return []

    by_id: dict[str, LifestyleUser] = {uid: prof for uid, prof in users}
    ids = [uid for uid, _ in users]

    edges: list[tuple[float, str, str]] = []
    for i in range(n):
        for j in range(i + 1, n):
            id_a, id_b = ids[i], ids[j]
            id_lo, id_hi = sorted([id_a, id_b])
            ua, ub = by_id[id_lo], by_id[id_hi]
            # viewer/candidate 고정: UUID 오름차순을 항상 (A, B)로 두어 쌍별 점수 정의를 일관되게 한다.
            result = compute_match(ua, ub)
            if result["match_status"] != "ok":
                continue
            score = float(result["final_score"])
            edges.append((score, id_lo, id_hi))

    edges.sort(key=lambda t: t[0], reverse=True)
    matched: set[str] = set()
    pairs: list[BatchMatchPair] = []

    for score, a_id, b_id in edges:
        if a_id in matched or b_id in matched:
            continue
        matched.add(a_id)
        matched.add(b_id)
        pairs.append(BatchMatchPair(user_a_id=a_id, user_b_id=b_id, score=round(score, 2)))

    return pairs


def batch_match_endpoint(body: BatchMatchRequest) -> BatchMatchResponse:
    entries = [(u.user_id, u.profile) for u in body.users]
    pairs = run_batch_greedy_unique_pairs(entries)
    return BatchMatchResponse(pairs=pairs)
