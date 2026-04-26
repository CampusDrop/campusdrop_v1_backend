from __future__ import annotations

from app.availability import (
    availability_overlap_count,
    availability_pair_compatible_for_matching,
    is_matchable_meeting_slot,
    normalized_slot_keys,
    overlapping_slot_keys,
)
from app.batch_match import run_batch_female_coverage_matching, run_batch_greedy_unique_pairs
from app.matching import compute_match
from app.schemas import AvailabilitySlot, LifestyleUser


def _u(**kwargs: object) -> LifestyleUser:
    base = {
        "energy": 3,
        "weekend": 3,
        "pattern": 3,
        "trend": 3,
        "alcohol": 3,
        "contact": 3,
        "meeting": 3,
        "planning": 3,
        "affection": 3,
        "date_expense": 3,
        "friends": 3,
        "jealousy": 3,
        "skinship_speed": 3,
        "skinship_limit": 3,
        "date_drinking": 3,
        "religion_intensity": 3,
        "politics": 3,
        "marriage_view": 3,
        "meeting_seriousness": 3,
        "job_view": 3,
        "spending": 3,
        "conflict": 3,
        "empathy": 3,
        "honesty": 3,
        "trust": 3,
        "smoking": "비흡연",
        "tattoo": "없음",
        "religion_type": "없음",
        "pref_smoking": "상관없음",
        "pref_tattoo": "상관없음",
        "pref_religion": "상관없음",
        "pref_cc": "상관없음",
        "cc": None,
        "match_profile": None,
    }
    base.update(kwargs)
    return LifestyleUser.model_validate(base)


def test_overlap_different_days() -> None:
    a = [AvailabilitySlot(date="2026-04-21", time_slot="11:00-12:00")]
    b = [AvailabilitySlot(date="2026-04-22", time_slot="11:00-12:00")]
    assert availability_overlap_count(a, b) == 0
    assert not availability_pair_compatible_for_matching(a, b)


def test_overlap_same_slot() -> None:
    s = AvailabilitySlot(date="2026-04-21", time_slot="11:00-12:00")
    a = [s]
    b = [AvailabilitySlot(date="2026-04-21", time_slot="11:00-12:00")]
    assert availability_overlap_count(a, b) == 1
    assert availability_pair_compatible_for_matching(a, b)


def test_same_day_adjacent_slots_no_overlap() -> None:
    a = [AvailabilitySlot(date="2026-04-21", time_slot="11:00-12:00")]
    b = [AvailabilitySlot(date="2026-04-21", time_slot="12:00-13:00")]
    assert availability_overlap_count(a, b) == 0


def test_midnight_spanning_slot_string_match() -> None:
    """검증기가 허용하는 자정 넘김 1시간 구간은 문자열 동일성으로만 겹침 판정."""
    a = [AvailabilitySlot(date="2026-04-21", time_slot="23:00-00:00")]
    b = [AvailabilitySlot(date="2026-04-21", time_slot="23:00-00:00")]
    assert availability_overlap_count(a, b) == 1
    assert not availability_pair_compatible_for_matching(a, b)


def test_matching_excludes_slots_starting_at_20_or_later() -> None:
    early = AvailabilitySlot(date="2026-04-21", time_slot="19:00-20:00")
    late = AvailabilitySlot(date="2026-04-21", time_slot="20:00-21:00")
    later = AvailabilitySlot(date="2026-04-21", time_slot="21:00-22:00")

    assert is_matchable_meeting_slot(early)
    assert not is_matchable_meeting_slot(late)
    assert not is_matchable_meeting_slot(later)
    assert availability_pair_compatible_for_matching([early], [early])
    assert not availability_pair_compatible_for_matching([late], [late])
    assert overlapping_slot_keys([early, late], [early, late]) == ["2026-04-21\t19:00-20:00"]


def test_matching_temporarily_excludes_monday_slots() -> None:
    monday = AvailabilitySlot(date="2026-04-20", time_slot="19:00-20:00")
    tuesday = AvailabilitySlot(date="2026-04-21", time_slot="19:00-20:00")

    assert not is_matchable_meeting_slot(monday)
    assert is_matchable_meeting_slot(tuesday)
    assert availability_overlap_count([monday], [monday]) == 1
    assert not availability_pair_compatible_for_matching([monday], [monday])


def test_duplicate_slots_counted_once() -> None:
    a = [
        AvailabilitySlot(date="2026-04-21", time_slot="11:00-12:00"),
        AvailabilitySlot(date="2026-04-21", time_slot="11:00-12:00"),
    ]
    b = [AvailabilitySlot(date="2026-04-21", time_slot="11:00-12:00")]
    keys = normalized_slot_keys(a)
    assert len(keys) == 1
    assert availability_overlap_count(a, b) == 1


def test_both_empty_legacy_compatible() -> None:
    assert availability_pair_compatible_for_matching([], [])


def test_one_side_empty_incompatible() -> None:
    a = [AvailabilitySlot(date="2026-04-21", time_slot="11:00-12:00")]
    assert not availability_pair_compatible_for_matching(a, [])
    assert not availability_pair_compatible_for_matching([], a)


def test_compute_match_skips_time_when_availability_omitted() -> None:
    """구 API: availability_* 미전달(None)이면 시간 위반 없음."""
    ua = _u(pref_smoking="비흡연만")
    ub = _u(smoking="흡연")
    out = compute_match(ua, ub)
    assert out["match_status"] == "violated"
    rules0 = {v["rule"] for v in out["match_report"]["group_b"]["violations"]}
    assert "availability_mismatch" not in rules0

    out2 = compute_match(
        ua,
        ub,
        availability_a=[AvailabilitySlot(date="2026-04-21", time_slot="11:00-12:00")],
        availability_b=[AvailabilitySlot(date="2026-04-22", time_slot="14:00-15:00")],
    )
    assert out2["match_status"] == "violated"
    rules = {v["rule"] for v in out2["match_report"]["group_b"]["violations"]}
    assert "smoking" in rules
    assert "availability_mismatch" in rules


def test_batch_excludes_time_incompatible_pair() -> None:
    m = _u()
    f = _u()
    slot = AvailabilitySlot(date="2026-04-21", time_slot="11:00-12:00")
    slot_b = AvailabilitySlot(date="2026-04-22", time_slot="11:00-12:00")
    users = [
        ("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", m, "male", [slot]),
        ("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", f, "female", [slot_b]),
    ]
    pairs = run_batch_greedy_unique_pairs(users, set())
    assert pairs == []


def test_batch_pair_with_overlap() -> None:
    m = _u()
    f = _u()
    slot = AvailabilitySlot(date="2026-04-21", time_slot="11:00-12:00")
    users = [
        ("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", m, "male", [slot]),
        ("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", f, "female", [slot]),
    ]
    pairs = run_batch_greedy_unique_pairs(users, set())
    assert len(pairs) == 1
    assert pairs[0].score > 0


def test_batch_protects_female_with_sparse_time_candidates() -> None:
    shared = AvailabilitySlot(date="2026-04-21", time_slot="11:00-12:00")
    backup = AvailabilitySlot(date="2026-04-21", time_slot="12:00-13:00")
    female_flexible = _u()
    female_sparse = _u(energy=1, weekend=1, pattern=1, trend=1, contact=1)
    male_best_for_flexible = _u()
    male_backup = _u(energy=4, weekend=4, pattern=4, trend=4, contact=4)

    users = [
        ("female-flexible", female_flexible, "female", [shared, backup]),
        ("female-sparse", female_sparse, "female", [shared]),
        ("male-best", male_best_for_flexible, "male", [shared]),
        ("male-backup", male_backup, "male", [backup]),
    ]

    result = run_batch_female_coverage_matching(users, set())
    matched_sets = {frozenset((pair.user_a_id, pair.user_b_id)) for pair in result.pairs}

    assert len(result.pairs) == 2
    assert frozenset(("female-sparse", "male-best")) in matched_sets
    assert frozenset(("female-flexible", "male-backup")) in matched_sets
    matched_slots = [pair.matched_slot for pair in result.pairs]
    assert all(slot is not None for slot in matched_slots)
    assert {f"{slot.date}\t{slot.time_slot}" for slot in matched_slots if slot is not None} == {
        "2026-04-21\t11:00-12:00",
        "2026-04-21\t12:00-13:00",
    }


def test_batch_does_not_schedule_two_pairs_in_same_slot() -> None:
    only_slot = AvailabilitySlot(date="2026-04-21", time_slot="11:00-12:00")
    users = [
        ("female-a", _u(), "female", [only_slot]),
        ("female-b", _u(), "female", [only_slot]),
        ("male-a", _u(), "male", [only_slot]),
        ("male-b", _u(), "male", [only_slot]),
    ]

    result = run_batch_female_coverage_matching(users, set())

    assert len(result.pairs) == 1
    assert result.pairs[0].matched_slot == only_slot
    assert result.pairs[0].match_report["batch_match_selection"]["matched_slot"] == {
        "date": "2026-04-21",
        "time_slot": "11:00-12:00",
    }


def test_batch_large_candidate_pool_uses_slot_safe_fallback() -> None:
    slots = [
        AvailabilitySlot(date="2026-04-21", time_slot="10:00-11:00"),
        AvailabilitySlot(date="2026-04-21", time_slot="11:00-12:00"),
        AvailabilitySlot(date="2026-04-21", time_slot="12:00-13:00"),
        AvailabilitySlot(date="2026-04-21", time_slot="13:00-14:00"),
        AvailabilitySlot(date="2026-04-21", time_slot="14:00-15:00"),
    ]
    users = []
    for i in range(24):
        users.append((f"female-{i:02d}", _u(), "female", slots))
        users.append((f"male-{i:02d}", _u(), "male", slots))

    result = run_batch_female_coverage_matching(users, set())
    slot_keys = [
        f"{pair.matched_slot.date}\t{pair.matched_slot.time_slot}"
        for pair in result.pairs
        if pair.matched_slot is not None
    ]

    assert len(result.pairs) == len(set(slot_keys))
    assert len(result.pairs) == len(slots)


def test_batch_forbidden_pairs_are_excluded() -> None:
    slot = AvailabilitySlot(date="2026-04-21", time_slot="11:00-12:00")
    users = [
        ("female-a", _u(), "female", [slot]),
        ("male-a", _u(), "male", [slot]),
    ]

    result = run_batch_female_coverage_matching(users, {"female-a|male-a"})

    assert result.pairs == []
    assert result.unmatched_females[0].reason == "no_match_candidates"
    assert result.unmatched_females[0].time_candidate_count == 1


def test_batch_reports_female_without_any_time_candidate() -> None:
    users = [
        ("female-a", _u(), "female", [AvailabilitySlot(date="2026-04-21", time_slot="11:00-12:00")]),
        ("male-a", _u(), "male", [AvailabilitySlot(date="2026-04-22", time_slot="11:00-12:00")]),
    ]

    result = run_batch_female_coverage_matching(users, set())

    assert result.pairs == []
    assert len(result.unmatched_females) == 1
    assert result.unmatched_females[0].user_id == "female-a"
    assert result.unmatched_females[0].reason == "no_time_candidates"
