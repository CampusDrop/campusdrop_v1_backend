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
        ("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", m, "male", [slot], None, None, None),
        ("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", f, "female", [slot_b], None, None, None),
    ]
    pairs = run_batch_greedy_unique_pairs(users, set())
    assert pairs == []


def test_batch_pair_with_overlap() -> None:
    m = _u()
    f = _u()
    slot = AvailabilitySlot(date="2026-04-21", time_slot="11:00-12:00")
    users = [
        ("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", m, "male", [slot], None, None, None),
        ("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", f, "female", [slot], None, None, None),
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
        ("female-flexible", female_flexible, "female", [shared, backup], None, None, None),
        ("female-sparse", female_sparse, "female", [shared], None, None, None),
        ("male-best", male_best_for_flexible, "male", [shared], None, None, None),
        ("male-backup", male_backup, "male", [backup], None, None, None),
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


def test_batch_allows_at_most_one_pair_per_slot() -> None:
    only_slot = AvailabilitySlot(date="2026-04-21", time_slot="11:00-12:00")
    users = [
        ("female-a", _u(), "female", [only_slot], None, None, None),
        ("female-b", _u(), "female", [only_slot], None, None, None),
        ("male-a", _u(), "male", [only_slot], None, None, None),
        ("male-b", _u(), "male", [only_slot], None, None, None),
    ]

    result = run_batch_female_coverage_matching(users, set())

    assert len(result.pairs) == 1
    assert all(pair.matched_slot == only_slot for pair in result.pairs)


def test_batch_multiple_couples_share_slot_only_once() -> None:
    """같은 슬롯만 가진 많은 사람이 있어도 슬롯당 1쌍까지만 같은 시간대에 배정."""
    only_slot = AvailabilitySlot(date="2026-04-21", time_slot="11:00-12:00")
    users = [
        ("female-a", _u(), "female", [only_slot], None, None, None),
        ("female-b", _u(), "female", [only_slot], None, None, None),
        ("female-c", _u(), "female", [only_slot], None, None, None),
        ("male-a", _u(), "male", [only_slot], None, None, None),
        ("male-b", _u(), "male", [only_slot], None, None, None),
        ("male-c", _u(), "male", [only_slot], None, None, None),
    ]

    result = run_batch_female_coverage_matching(users, set())

    assert len(result.pairs) == 1
    assert all(pair.matched_slot == only_slot for pair in result.pairs)


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
        users.append((f"female-{i:02d}", _u(), "female", slots, None, None, None))
        users.append((f"male-{i:02d}", _u(), "male", slots, None, None, None))

    result = run_batch_female_coverage_matching(users, set())
    slot_keys = [
        f"{pair.matched_slot.date}\t{pair.matched_slot.time_slot}"
        for pair in result.pairs
        if pair.matched_slot is not None
    ]

    assert len(result.pairs) == len(slots)
    assert all(slot_keys.count(slot_key) <= 1 for slot_key in set(slot_keys))


def test_batch_forbidden_pairs_are_excluded() -> None:
    slot = AvailabilitySlot(date="2026-04-21", time_slot="11:00-12:00")
    users = [
        ("female-a", _u(), "female", [slot], None, None, None),
        ("male-a", _u(), "male", [slot], None, None, None),
    ]

    result = run_batch_female_coverage_matching(users, {"female-a|male-a"})

    assert result.pairs == []
    assert result.unmatched_females[0].reason == "no_match_candidates"
    assert result.unmatched_females[0].time_candidate_count == 1


def test_batch_reports_female_without_any_time_candidate() -> None:
    users = [
        ("female-a", _u(), "female", [AvailabilitySlot(date="2026-04-21", time_slot="11:00-12:00")], None, None, None),
        ("male-a", _u(), "male", [AvailabilitySlot(date="2026-04-22", time_slot="11:00-12:00")], None, None, None),
    ]

    result = run_batch_female_coverage_matching(users, set())

    assert result.pairs == []
    assert len(result.unmatched_females) == 1
    assert result.unmatched_females[0].user_id == "female-a"
    assert result.unmatched_females[0].reason == "no_time_candidates"


def test_compute_match_same_department_violates() -> None:
    ua = _u()
    ub = _u()
    out = compute_match(ua, ub, department_a="컴퓨터공학과", department_b="컴퓨터공학과")
    assert out["match_status"] == "violated"
    rules = {v["rule"] for v in out["match_report"]["group_b"]["violations"]}
    assert "same_department" in rules


def test_compute_match_different_department_ok() -> None:
    ua = _u()
    ub = _u()
    out = compute_match(ua, ub, department_a="컴퓨터공학과", department_b="경영학부")
    assert out["match_status"] == "ok"


def test_batch_excludes_same_department() -> None:
    dept = "수학통계학과"
    m = _u()
    f = _u()
    slot = AvailabilitySlot(date="2026-04-21", time_slot="11:00-12:00")
    users = [
        ("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", m, "male", [slot], dept, None, None),
        ("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", f, "female", [slot], dept, None, None),
    ]
    pairs = run_batch_greedy_unique_pairs(users, set())
    assert pairs == []


def test_batch_allows_when_department_unknown() -> None:
    """한쪽이라도 학과가 비어(None)면 동일 학과 하드 규칙을 쓰지 않는다."""
    m = _u()
    f = _u()
    slot = AvailabilitySlot(date="2026-04-21", time_slot="11:00-12:00")
    users = [
        ("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", m, "male", [slot], None, None, None),
        ("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", f, "female", [slot], "컴퓨터공학과", None, None),
    ]
    pairs = run_batch_greedy_unique_pairs(users, set())
    assert len(pairs) == 1


def test_age_gap_four_years_violates() -> None:
    ua = _u()
    ub = _u()
    out = compute_match(ua, ub, birth_year_a=2002, birth_year_b=2006)
    assert out["match_status"] == "violated"
    assert "age_gap_exceeded" in {v["rule"] for v in out["match_report"]["group_b"]["violations"]}


def test_age_gap_three_years_allowed() -> None:
    ua = _u()
    ub = _u()
    out = compute_match(ua, ub, birth_year_a=2002, birth_year_b=2005)
    assert out["match_status"] == "ok"


def test_partner_age_pref_requires_older_when_partner_older() -> None:
    """A(2003)보다 B(2000)가 연상이면 A는 OLDER를 허용해야 한다."""
    ua = _u()
    ub = _u()
    out = compute_match(
        ua,
        ub,
        birth_year_a=2003,
        birth_year_b=2000,
        partner_age_preference_a=["YOUNGER", "SAME_AGE"],
    )
    assert out["match_status"] == "violated"
    assert any(
        v["rule"] == "partner_age_preference" and v["viewer"] == "A" for v in out["match_report"]["group_b"]["violations"]
    )


def test_partner_age_pref_b_side_when_partner_younger() -> None:
    """B(2000)이 A(2003)를 연하로 보므로 B는 YOUNGER를 허용해야 한다."""
    ua = _u()
    ub = _u()
    out = compute_match(
        ua,
        ub,
        birth_year_a=2003,
        birth_year_b=2000,
        partner_age_preference_b=["OLDER", "SAME_AGE"],
    )
    assert out["match_status"] == "violated"
    assert any(
        v["rule"] == "partner_age_preference" and v["viewer"] == "B" for v in out["match_report"]["group_b"]["violations"]
    )


def test_batch_excludes_large_age_gap() -> None:
    m = _u()
    f = _u()
    slot = AvailabilitySlot(date="2026-04-21", time_slot="11:00-12:00")
    users = [
        ("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", m, "male", [slot], None, 2000, ["OLDER", "YOUNGER", "SAME_AGE"]),
        ("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", f, "female", [slot], None, 2005, ["OLDER", "YOUNGER", "SAME_AGE"]),
    ]
    pairs = run_batch_greedy_unique_pairs(users, set())
    assert pairs == []
