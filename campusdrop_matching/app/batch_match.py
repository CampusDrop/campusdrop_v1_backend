from __future__ import annotations

from app.matching import compute_match
from app.schemas import BatchMatchPair, BatchMatchRequest, BatchMatchResponse, LifestyleUser


def _pair_key(id_lo: str, id_hi: str) -> str:
    lo, hi = sorted((id_lo, id_hi))
    return f"{lo}|{hi}"


def _forbidden_pair_key_set(body: BatchMatchRequest) -> set[str]:
    out: set[str] = set()
    for pair in body.forbidden_pairs:
        if len(pair) != 2:
            continue
        a, b = str(pair[0]).strip(), str(pair[1]).strip()
        if a and b:
            out.add(_pair_key(a, b))
    return out


def _is_opposite_binary_male_female(ga: str | None, gb: str | None) -> bool:
    if ga not in ("male", "female") or gb not in ("male", "female"):
        return False
    return ga != gb


def run_batch_greedy_unique_pairs(
    users: list[tuple[str, LifestyleUser, str | None]],
    forbidden_keys: set[str],
) -> list[BatchMatchPair]:
    """
    모든 쌍의 매칭 점수를 한 번에 계산한 뒤, 점수 내림차순 그리디로 최대 1:1 배정(유저당 최대 한 번 등장).
    `forbidden_keys`에 있는 (정렬된) 쌍은 엣지에서 제외(과거 매칭 재매칭 방지).
    남성·여성 쌍만 점수 계산(이성 매칭 최우선).
    """
    n = len(users)
    if n < 2:
        return []

    by_id: dict[str, LifestyleUser] = {uid: prof for uid, prof, _ in users}
    gender_by_id: dict[str, str | None] = {uid: g for uid, _, g in users}
    ids = [uid for uid, _, _ in users]

    edges: list[tuple[float, str, str, dict | None]] = []
    for i in range(n):
        for j in range(i + 1, n):
            id_a, id_b = ids[i], ids[j]
            id_lo, id_hi = sorted([id_a, id_b])
            if _pair_key(id_lo, id_hi) in forbidden_keys:
                continue
            if not _is_opposite_binary_male_female(gender_by_id.get(id_lo), gender_by_id.get(id_hi)):
                continue
            ua, ub = by_id[id_lo], by_id[id_hi]
            # viewer/candidate 고정: UUID 오름차순을 항상 (A, B)로 두어 쌍별 점수 정의를 일관되게 한다.
            result = compute_match(ua, ub)
            if result["match_status"] != "ok":
                continue
            score = float(result["final_score"])
            edges.append((score, id_lo, id_hi, result.get("match_report")))

    edges.sort(key=lambda t: t[0], reverse=True)
    matched: set[str] = set()
    pairs: list[BatchMatchPair] = []

    for score, a_id, b_id, report in edges:
        if a_id in matched or b_id in matched:
            continue
        matched.add(a_id)
        matched.add(b_id)
        pairs.append(
            BatchMatchPair(
                user_a_id=a_id,
                user_b_id=b_id,
                score=round(score, 2),
                match_report=report if isinstance(report, dict) else None,
            )
        )

    return pairs


def batch_match_endpoint(body: BatchMatchRequest) -> BatchMatchResponse:
    entries: list[tuple[str, LifestyleUser, str | None]] = []
    for u in body.users:
        g = u.gender if u.gender in ("male", "female") else None
        entries.append((u.user_id, u.profile, g))
    forbidden_keys = _forbidden_pair_key_set(body)
    pairs = run_batch_greedy_unique_pairs(entries, forbidden_keys)
    return BatchMatchResponse(pairs=pairs)
