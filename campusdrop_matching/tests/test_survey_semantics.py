from __future__ import annotations

from app.matching import compute_match
from app.schemas import LifestyleUser


def _base() -> dict:
    return {
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
        "pref_smoking": "비흡연",
        "pref_tattoo": "상관없음",
        "pref_religion": "상관없음",
        "pref_cc": "상관없음",
        "cc": None,
        "match_profile": None,
    }


def test_soft_penalty_pref_smoking_level_2_vs_smoker() -> None:
    da = {
        **_base(),
        "pref_smoking": "비흡연",
        "match_profile": {
            "smoking": {"code": 0, "label": "비흡연"},
            "tattoo": {"code": 0, "label": "없음"},
            "religion": {"code": "none", "label": "없음"},
            "pref_smoking": {"level": 2, "tier": "soft_prefer_non_smoker", "label": "비흡연"},
            "pref_tattoo": {"level": 3, "tier": "neutral", "label": "상관없음"},
            "pref_religion": {"level": 3, "tier": "neutral", "label": "상관없음"},
            "pref_cc": {"level": 3, "tier": "neutral", "label": "상관없음"},
        },
    }
    db = {
        **_base(),
        "smoking": "흡연",
        "pref_smoking": "상관없음",
        "match_profile": {
            "smoking": {"code": 2, "label": "흡연"},
            "tattoo": {"code": 0, "label": "없음"},
            "religion": {"code": "none", "label": "없음"},
            "pref_smoking": {"level": 3, "tier": "neutral", "label": "상관없음"},
            "pref_tattoo": {"level": 3, "tier": "neutral", "label": "상관없음"},
            "pref_religion": {"level": 3, "tier": "neutral", "label": "상관없음"},
            "pref_cc": {"level": 3, "tier": "neutral", "label": "상관없음"},
        },
    }
    a = LifestyleUser.model_validate(da)
    b = LifestyleUser.model_validate(db)
    out = compute_match(a, b)
    assert out["match_status"] == "ok"
    sem = out["match_report"]["semantics"]
    assert sem["soft_penalty_total"] > 0
    assert any(x["rule"] == "pref_smoking_soft_prefer_non" for x in sem["soft_penalties"])


def test_hard_pref_smoking_level_1_vs_smoker() -> None:
    da = {
        **_base(),
        "pref_smoking": "비흡연만",
        "match_profile": {
            "smoking": {"code": 0, "label": "비흡연"},
            "tattoo": {"code": 0, "label": "없음"},
            "religion": {"code": "none", "label": "없음"},
            "pref_smoking": {"level": 1, "tier": "hard_absolutely_non_smoker", "label": "비흡연만"},
            "pref_tattoo": {"level": 3, "tier": "neutral", "label": "상관없음"},
            "pref_religion": {"level": 3, "tier": "neutral", "label": "상관없음"},
            "pref_cc": {"level": 3, "tier": "neutral", "label": "상관없음"},
        },
    }
    db = {
        **_base(),
        "smoking": "전자담배만",
        "match_profile": {
            "smoking": {"code": 1, "label": "전자담배만"},
            "tattoo": {"code": 0, "label": "없음"},
            "religion": {"code": "none", "label": "없음"},
            "pref_smoking": {"level": 3, "tier": "neutral", "label": "상관없음"},
            "pref_tattoo": {"level": 3, "tier": "neutral", "label": "상관없음"},
            "pref_religion": {"level": 3, "tier": "neutral", "label": "상관없음"},
            "pref_cc": {"level": 3, "tier": "neutral", "label": "상관없음"},
        },
    }
    a = LifestyleUser.model_validate(da)
    b = LifestyleUser.model_validate(db)
    out = compute_match(a, b)
    assert out["match_status"] == "violated"


def test_date_expense_is_complementary_axis() -> None:
    low = LifestyleUser.model_validate({**_base(), "date_expense": 1})
    complementary_high = LifestyleUser.model_validate({**_base(), "date_expense": 5})
    same_low = LifestyleUser.model_validate({**_base(), "date_expense": 1})

    complementary = compute_match(low, complementary_high)
    same = compute_match(low, same_low)

    assert complementary["final_score"] > same["final_score"]
    complementary_axis = next(
        d for d in complementary["match_report"]["group_a"]["manhattan_per_dimension"] if d["field"] == "date_expense"
    )
    same_axis = next(d for d in same["match_report"]["group_a"]["manhattan_per_dimension"] if d["field"] == "date_expense")
    assert complementary_axis["abs_diff"] == 0.0
    assert same_axis["abs_diff"] == 4.0
    assert complementary_axis["match_mode"] == "complementary_sum_to_6"
