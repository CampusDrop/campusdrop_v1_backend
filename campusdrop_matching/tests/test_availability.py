from __future__ import annotations

from app.availability import (
    availability_overlap_count,
    availability_pair_compatible_for_matching,
    normalized_slot_keys,
)
from app.batch_match import run_batch_greedy_unique_pairs
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
    a = [AvailabilitySlot(date="2026-04-20", time_slot="11:00-12:00")]
    b = [AvailabilitySlot(date="2026-04-21", time_slot="11:00-12:00")]
    assert availability_overlap_count(a, b) == 0
    assert not availability_pair_compatible_for_matching(a, b)


def test_overlap_same_slot() -> None:
    s = AvailabilitySlot(date="2026-04-20", time_slot="11:00-12:00")
    a = [s]
    b = [AvailabilitySlot(date="2026-04-20", time_slot="11:00-12:00")]
    assert availability_overlap_count(a, b) == 1
    assert availability_pair_compatible_for_matching(a, b)


def test_same_day_adjacent_slots_no_overlap() -> None:
    a = [AvailabilitySlot(date="2026-04-20", time_slot="11:00-12:00")]
    b = [AvailabilitySlot(date="2026-04-20", time_slot="12:00-13:00")]
    assert availability_overlap_count(a, b) == 0


def test_midnight_spanning_slot_string_match() -> None:
    """검증기가 허용하는 자정 넘김 1시간 구간은 문자열 동일성으로만 겹침 판정."""
    a = [AvailabilitySlot(date="2026-04-20", time_slot="23:00-00:00")]
    b = [AvailabilitySlot(date="2026-04-20", time_slot="23:00-00:00")]
    assert availability_overlap_count(a, b) == 1


def test_duplicate_slots_counted_once() -> None:
    a = [
        AvailabilitySlot(date="2026-04-20", time_slot="11:00-12:00"),
        AvailabilitySlot(date="2026-04-20", time_slot="11:00-12:00"),
    ]
    b = [AvailabilitySlot(date="2026-04-20", time_slot="11:00-12:00")]
    keys = normalized_slot_keys(a)
    assert len(keys) == 1
    assert availability_overlap_count(a, b) == 1


def test_both_empty_legacy_compatible() -> None:
    assert availability_pair_compatible_for_matching([], [])


def test_one_side_empty_incompatible() -> None:
    a = [AvailabilitySlot(date="2026-04-20", time_slot="11:00-12:00")]
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
        availability_a=[AvailabilitySlot(date="2026-04-20", time_slot="11:00-12:00")],
        availability_b=[AvailabilitySlot(date="2026-04-21", time_slot="14:00-15:00")],
    )
    assert out2["match_status"] == "violated"
    rules = {v["rule"] for v in out2["match_report"]["group_b"]["violations"]}
    assert "smoking" in rules
    assert "availability_mismatch" in rules


def test_batch_excludes_time_incompatible_pair() -> None:
    m = _u()
    f = _u()
    slot = AvailabilitySlot(date="2026-04-20", time_slot="11:00-12:00")
    slot_b = AvailabilitySlot(date="2026-04-21", time_slot="11:00-12:00")
    users = [
        ("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", m, "male", [slot]),
        ("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", f, "female", [slot_b]),
    ]
    pairs = run_batch_greedy_unique_pairs(users, set())
    assert pairs == []


def test_batch_pair_with_overlap() -> None:
    m = _u()
    f = _u()
    slot = AvailabilitySlot(date="2026-04-20", time_slot="11:00-12:00")
    users = [
        ("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", m, "male", [slot]),
        ("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", f, "female", [slot]),
    ]
    pairs = run_batch_greedy_unique_pairs(users, set())
    assert len(pairs) == 1
    assert pairs[0].score > 0
