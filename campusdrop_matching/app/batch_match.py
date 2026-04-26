from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from app.availability import availability_pair_compatible_for_matching, overlapping_slot_keys, slot_key_to_availability_slot
from app.matching import compute_match
from app.schemas import (
    AvailabilitySlot,
    BatchMatchPair,
    BatchMatchRequest,
    BatchMatchResponse,
    BatchUnmatchedFemale,
    LifestyleUser,
)

_MAX_EXACT_SLOT_OPTIMIZATION_EDGES = 220
_MAX_EXACT_SLOT_OPTIMIZATION_FEMALES = 18


@dataclass(frozen=True)
class _CandidateEdge:
    female_id: str
    male_id: str
    user_a_id: str
    user_b_id: str
    score: float
    female_score: float
    male_score: float
    slot_key: str | None
    match_report: dict[str, Any] | None


@dataclass(frozen=True)
class _BatchMatchResult:
    pairs: list[BatchMatchPair]
    unmatched_females: list[BatchUnmatchedFemale]
    match_summary: dict[str, Any]


@dataclass
class _FlowArc:
    to: int
    rev: int
    cap: int
    cost: int
    edge_index: int | None = None


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


def _add_arc(graph: list[list[_FlowArc]], fr: int, to: int, cap: int, cost: int, edge_index: int | None = None) -> _FlowArc:
    fwd = _FlowArc(to=to, rev=len(graph[to]), cap=cap, cost=cost, edge_index=edge_index)
    rev = _FlowArc(to=fr, rev=len(graph[fr]), cap=0, cost=-cost)
    graph[fr].append(fwd)
    graph[to].append(rev)
    return fwd


def _edges_by_female(edges: list[_CandidateEdge]) -> list[tuple[str, list[int]]]:
    grouped: dict[str, list[int]] = {}
    for i, edge in enumerate(edges):
        grouped.setdefault(edge.female_id, []).append(i)
    return sorted(grouped.items(), key=lambda item: (len(item[1]), item[0]))


def _resource_bits(edges: list[_CandidateEdge]) -> tuple[dict[str, int], dict[str, int]]:
    male_bits = {male_id: 1 << i for i, male_id in enumerate(sorted({edge.male_id for edge in edges}))}
    slot_values = sorted({edge.slot_key for edge in edges if edge.slot_key is not None})
    slot_bits = {slot_key: 1 << i for i, slot_key in enumerate(slot_values)}
    return male_bits, slot_bits


def _use_exact_slot_optimization(edges: list[_CandidateEdge]) -> bool:
    return (
        len(edges) <= _MAX_EXACT_SLOT_OPTIMIZATION_EDGES
        and len({edge.female_id for edge in edges}) <= _MAX_EXACT_SLOT_OPTIMIZATION_FEMALES
    )


def _greedy_slot_safe_selection(
    edges: list[_CandidateEdge],
    *,
    min_female_score: float | None = None,
    target_count: int | None = None,
) -> list[_CandidateEdge]:
    filtered = [
        edge
        for edge in edges
        if min_female_score is None or edge.female_score + 1e-9 >= min_female_score
    ]
    candidate_counts: dict[str, int] = {}
    for edge in filtered:
        candidate_counts[edge.female_id] = candidate_counts.get(edge.female_id, 0) + 1

    ordered = sorted(
        filtered,
        key=lambda edge: (
            candidate_counts.get(edge.female_id, 0),
            -edge.female_score,
            -edge.score,
            -edge.male_score,
            edge.female_id,
            edge.male_id,
            edge.slot_key or "",
        ),
    )
    selected: list[_CandidateEdge] = []
    used_females: set[str] = set()
    used_males: set[str] = set()
    used_slots: set[str] = set()
    for edge in ordered:
        if target_count is not None and len(selected) >= target_count:
            break
        if edge.female_id in used_females or edge.male_id in used_males:
            continue
        if edge.slot_key is not None and edge.slot_key in used_slots:
            continue
        selected.append(edge)
        used_females.add(edge.female_id)
        used_males.add(edge.male_id)
        if edge.slot_key is not None:
            used_slots.add(edge.slot_key)

    selected.sort(key=lambda e: (-e.female_score, -e.score, -e.male_score, e.user_a_id, e.user_b_id, e.slot_key or ""))
    return selected


def _max_cardinality(edges: list[_CandidateEdge], *, min_female_score: float | None = None) -> int:
    filtered = [
        edge
        for edge in edges
        if min_female_score is None or edge.female_score + 1e-9 >= min_female_score
    ]
    if not filtered:
        return 0
    if not _use_exact_slot_optimization(filtered):
        return len(_greedy_slot_safe_selection(filtered))

    female_groups = _edges_by_female(filtered)
    male_bits, slot_bits = _resource_bits(filtered)

    @lru_cache(maxsize=None)
    def solve(group_idx: int, used_males: int, used_slots: int) -> int:
        if group_idx >= len(female_groups):
            return 0
        best = solve(group_idx + 1, used_males, used_slots)
        for edge_idx in female_groups[group_idx][1]:
            edge = filtered[edge_idx]
            male_bit = male_bits[edge.male_id]
            slot_bit = slot_bits.get(edge.slot_key, 0)
            if used_males & male_bit or used_slots & slot_bit:
                continue
            best = max(best, 1 + solve(group_idx + 1, used_males | male_bit, used_slots | slot_bit))
        return best

    return solve(0, 0, 0)


def _best_minimum_female_score(edges: list[_CandidateEdge], target_count: int) -> float:
    if target_count <= 0:
        return 0.0
    scores = sorted({round(edge.female_score, 6) for edge in edges})
    lo = 0
    hi = len(scores) - 1
    answer = scores[0]
    while lo <= hi:
        mid = (lo + hi) // 2
        if _max_cardinality(edges, min_female_score=scores[mid]) >= target_count:
            answer = scores[mid]
            lo = mid + 1
        else:
            hi = mid - 1
    return answer


def _edge_weight(edge: _CandidateEdge) -> int:
    female = int(round(edge.female_score * 100.0))
    overall = int(round(edge.score * 100.0))
    male = int(round(edge.male_score * 100.0))
    return female * 1_000_000 + overall * 1_000 + male


def _min_cost_max_flow_selected_edges(edges: list[_CandidateEdge], target_count: int) -> list[_CandidateEdge]:
    if target_count <= 0:
        return []

    female_ids = sorted({edge.female_id for edge in edges})
    male_ids = sorted({edge.male_id for edge in edges})
    source = 0
    female_offset = 1
    male_offset = female_offset + len(female_ids)
    sink = male_offset + len(male_ids)
    graph: list[list[_FlowArc]] = [[] for _ in range(sink + 1)]

    female_node = {female_id: female_offset + i for i, female_id in enumerate(female_ids)}
    male_node = {male_id: male_offset + i for i, male_id in enumerate(male_ids)}

    for female_id in female_ids:
        _add_arc(graph, source, female_node[female_id], 1, 0)
    for male_id in male_ids:
        _add_arc(graph, male_node[male_id], sink, 1, 0)

    tracked_arcs: list[tuple[int, _FlowArc]] = []
    for i, edge in enumerate(edges):
        arc = _add_arc(graph, female_node[edge.female_id], male_node[edge.male_id], 1, -_edge_weight(edge), i)
        tracked_arcs.append((i, arc))

    flow = 0
    node_count = len(graph)
    while flow < target_count:
        dist = [10**30] * node_count
        in_queue = [False] * node_count
        prev_node = [-1] * node_count
        prev_arc = [-1] * node_count
        dist[source] = 0
        queue = [source]
        in_queue[source] = True
        head = 0

        while head < len(queue):
            node = queue[head]
            head += 1
            in_queue[node] = False
            for arc_index, arc in enumerate(graph[node]):
                if arc.cap <= 0:
                    continue
                next_cost = dist[node] + arc.cost
                if next_cost < dist[arc.to]:
                    dist[arc.to] = next_cost
                    prev_node[arc.to] = node
                    prev_arc[arc.to] = arc_index
                    if not in_queue[arc.to]:
                        queue.append(arc.to)
                        in_queue[arc.to] = True

        if prev_node[sink] == -1:
            break

        node = sink
        while node != source:
            arc = graph[prev_node[node]][prev_arc[node]]
            arc.cap -= 1
            graph[node][arc.rev].cap += 1
            node = prev_node[node]
        flow += 1

    selected = [edges[i] for i, arc in tracked_arcs if arc.cap == 0]
    selected.sort(key=lambda e: (-e.female_score, -e.score, -e.male_score, e.user_a_id, e.user_b_id))
    return selected


def _best_weighted_selection(edges: list[_CandidateEdge], target_count: int) -> list[_CandidateEdge]:
    if target_count <= 0 or not edges:
        return []
    if not _use_exact_slot_optimization(edges):
        return _greedy_slot_safe_selection(edges, target_count=target_count)

    female_groups = _edges_by_female(edges)
    male_bits, slot_bits = _resource_bits(edges)

    for _, edge_indices in female_groups:
        edge_indices.sort(
            key=lambda i: (
                -_edge_weight(edges[i]),
                edges[i].user_a_id,
                edges[i].user_b_id,
                edges[i].slot_key or "",
            )
        )

    @lru_cache(maxsize=None)
    def solve(group_idx: int, used_males: int, used_slots: int, remaining: int) -> tuple[int, tuple[int, ...]] | None:
        if remaining == 0:
            return (0, ())
        if group_idx >= len(female_groups):
            return None
        if len(female_groups) - group_idx < remaining:
            return None

        best: tuple[int, tuple[int, ...]] | None = solve(group_idx + 1, used_males, used_slots, remaining)
        for edge_idx in female_groups[group_idx][1]:
            edge = edges[edge_idx]
            male_bit = male_bits[edge.male_id]
            slot_bit = slot_bits.get(edge.slot_key, 0)
            if used_males & male_bit or used_slots & slot_bit:
                continue
            tail = solve(group_idx + 1, used_males | male_bit, used_slots | slot_bit, remaining - 1)
            if tail is None:
                continue
            candidate = (_edge_weight(edge) + tail[0], (edge_idx, *tail[1]))
            if best is None or candidate[0] > best[0] or (candidate[0] == best[0] and candidate[1] < best[1]):
                best = candidate
        return best

    result = solve(0, 0, 0, target_count)
    if result is None:
        return []
    selected = [edges[i] for i in result[1]]
    selected.sort(key=lambda e: (-e.female_score, -e.score, -e.male_score, e.user_a_id, e.user_b_id, e.slot_key or ""))
    return selected


def run_batch_female_coverage_matching(
    users: list[tuple[str, LifestyleUser, str | None, list[AvailabilitySlot]]],
    forbidden_keys: set[str],
) -> _BatchMatchResult:
    """
    여성 커버리지 우선 배치 매칭.

    `forbidden_keys`에 있는 (정렬된) 쌍은 엣지에서 제외(과거 매칭 재매칭 방지).
    남성·여성 쌍만 점수 계산(이성 매칭 최우선).
    `compute_match` 하드필터를 통과한 후보만 사용한다.

    최적화 우선순위:
    1. 매칭 가능한 여성 수 최대화
    2. 선택된 여성 후보의 최저 `female_score` 최대화
    3. 여성 평균 만족도(고정 cardinality에서 합계) 최대화
    4. 전체 점수와 남성 점수로 동점 처리
    """
    n = len(users)
    if n < 2:
        return _BatchMatchResult(pairs=[], unmatched_females=[], match_summary={"matched_count": 0, "target_count": 0})

    by_id: dict[str, LifestyleUser] = {uid: prof for uid, prof, _, _ in users}
    gender_by_id: dict[str, str | None] = {uid: g for uid, _, g, _ in users}
    avail_by_id: dict[str, list[AvailabilitySlot]] = {uid: av for uid, _, _, av in users}
    ids = [uid for uid, _, _, _ in users]
    female_ids = sorted(uid for uid in ids if gender_by_id.get(uid) == "female")
    time_candidate_counts: dict[str, int] = {uid: 0 for uid in female_ids}
    match_candidate_counts: dict[str, int] = {uid: 0 for uid in female_ids}

    edges: list[_CandidateEdge] = []
    for i in range(n):
        for j in range(i + 1, n):
            id_a, id_b = ids[i], ids[j]
            id_lo, id_hi = sorted([id_a, id_b])
            if not _is_opposite_binary_male_female(gender_by_id.get(id_lo), gender_by_id.get(id_hi)):
                continue
            female_id = id_lo if gender_by_id.get(id_lo) == "female" else id_hi
            male_id = id_hi if female_id == id_lo else id_lo
            if availability_pair_compatible_for_matching(avail_by_id[female_id], avail_by_id[male_id]):
                time_candidate_counts[female_id] += 1
            if _pair_key(id_lo, id_hi) in forbidden_keys:
                continue
            ua, ub = by_id[id_lo], by_id[id_hi]
            # viewer/candidate 고정: UUID 오름차순을 항상 (A, B)로 두어 쌍별 점수 정의를 일관되게 한다.
            result = compute_match(
                ua,
                ub,
                availability_a=avail_by_id[id_lo],
                availability_b=avail_by_id[id_hi],
            )
            if result["match_status"] != "ok":
                continue
            score = float(result["final_score"])
            female_score = float(result.get("female_score", score))
            male_score = float(result.get("male_score", score))
            match_candidate_counts[female_id] += 1
            slot_keys = overlapping_slot_keys(avail_by_id[id_lo], avail_by_id[id_hi])
            if not slot_keys and availability_pair_compatible_for_matching(avail_by_id[id_lo], avail_by_id[id_hi]):
                slot_keys = [None]
            for slot_key in slot_keys:
                edges.append(
                    _CandidateEdge(
                        female_id=female_id,
                        male_id=male_id,
                        user_a_id=id_lo,
                        user_b_id=id_hi,
                        score=score,
                        female_score=female_score,
                        male_score=male_score,
                        slot_key=slot_key,
                        match_report=result.get("match_report") if isinstance(result.get("match_report"), dict) else None,
                    )
                )

    target_count = _max_cardinality(edges)
    min_female_score = _best_minimum_female_score(edges, target_count) if target_count else 0.0
    eligible_edges = [edge for edge in edges if edge.female_score + 1e-9 >= min_female_score]
    selected_edges = _best_weighted_selection(eligible_edges, target_count)
    matched_females = {edge.female_id for edge in selected_edges}

    pairs: list[BatchMatchPair] = []
    for edge in selected_edges:
        report = edge.match_report
        matched_slot = slot_key_to_availability_slot(edge.slot_key) if edge.slot_key is not None else None
        matched_slot_payload = matched_slot.model_dump() if matched_slot is not None else None
        if isinstance(report, dict):
            report = {
                **report,
                "batch_match_selection": {
                    "female_score": round(edge.female_score, 2),
                    "male_score": round(edge.male_score, 2),
                    "matched_slot": matched_slot_payload,
                    "optimization_priority": [
                        "max_female_coverage",
                        "max_min_female_score",
                        "max_average_female_score",
                        "overall_and_male_score_tiebreak",
                    ],
                },
            }
        pairs.append(
            BatchMatchPair(
                user_a_id=edge.user_a_id,
                user_b_id=edge.user_b_id,
                score=round(edge.score, 2),
                matched_slot=matched_slot,
                match_report=report if isinstance(report, dict) else None,
            )
        )

    pairs.sort(key=lambda p: (-p.score, p.user_a_id, p.user_b_id))

    unmatched_females: list[BatchUnmatchedFemale] = []
    for female_id in female_ids:
        if female_id in matched_females:
            continue
        if time_candidate_counts[female_id] == 0:
            reason = "no_time_candidates"
        elif match_candidate_counts[female_id] == 0:
            reason = "no_match_candidates"
        else:
            reason = "unmatched_after_optimization"
        unmatched_females.append(
            BatchUnmatchedFemale(
                user_id=female_id,
                reason=reason,
                time_candidate_count=time_candidate_counts[female_id],
                match_candidate_count=match_candidate_counts[female_id],
            )
        )

    match_summary = {
        "algorithm": "female_coverage_lexicographic_bipartite_matching",
        "candidate_edge_count": len(edges),
        "female_count": len(female_ids),
        "matched_count": len(pairs),
        "target_count": target_count,
        "minimum_female_score": round(min_female_score, 2) if target_count else None,
        "priority": [
            "hard_filters",
            "max_female_coverage",
            "max_min_female_score",
            "max_average_female_score",
            "overall_and_male_score_tiebreak",
        ],
    }
    return _BatchMatchResult(pairs=pairs, unmatched_females=unmatched_females, match_summary=match_summary)


def run_batch_greedy_unique_pairs(
    users: list[tuple[str, LifestyleUser, str | None, list[AvailabilitySlot]]],
    forbidden_keys: set[str],
) -> list[BatchMatchPair]:
    """Backward-compatible wrapper for tests/importers; implementation is no longer greedy."""
    return run_batch_female_coverage_matching(users, forbidden_keys).pairs


def batch_match_endpoint(body: BatchMatchRequest) -> BatchMatchResponse:
    entries: list[tuple[str, LifestyleUser, str | None, list[AvailabilitySlot]]] = []
    for u in body.users:
        g = u.gender if u.gender in ("male", "female") else None
        entries.append((u.user_id, u.profile, g, u.availability))
    forbidden_keys = _forbidden_pair_key_set(body)
    result = run_batch_female_coverage_matching(entries, forbidden_keys)
    return BatchMatchResponse(
        pairs=result.pairs,
        unmatched_females=result.unmatched_females,
        match_summary=result.match_summary,
    )
