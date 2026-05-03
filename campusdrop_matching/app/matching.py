from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal

import numpy as np

from app.availability import availability_pair_compatible_for_matching
from app.survey_semantics_runtime import (
    collect_soft_penalty_entries,
    get_match_profile,
    partner_smoking_code,
    partner_tattoo_code,
    pref_level,
    survey_semantics,
)
from app.schemas import (
    CONTINUOUS_KEYS,
    CONTINUOUS_WEIGHTS,
    RELIGION_SOFT_WEIGHT,
    AvailabilitySlot,
    LifestyleUser,
)

_LIKERT_MAX_DIFF = 4.0
_COMPLEMENTARY_LIKERT_KEYS = {"date_expense"}

AXIS_LABEL_KO: dict[str, str] = {
    "energy": "에너지·활동성",
    "weekend": "주말·휴식 패턴",
    "pattern": "생활 패턴",
    "trend": "트렌드·새로움",
    "alcohol": "음주",
    "contact": "연락·소통",
    "meeting": "만남 빈도",
    "planning": "계획성",
    "affection": "애정 표현",
    "date_expense": "데이트 비용",
    "friends": "친구·사교",
    "jealousy": "질투",
    "skinship_speed": "스킨십 속도",
    "skinship_limit": "스킨십 한계",
    "date_drinking": "데이트 음주",
    "religion_intensity": "종교 실천·중요도",
    "politics": "정치·사회관",
    "marriage_view": "결혼·연애관",
    "meeting_seriousness": "만남의 진지함",
    "job_view": "일·커리어관",
    "spending": "소비관",
    "conflict": "갈등 대응",
    "empathy": "공감",
    "honesty": "솔직함",
    "trust": "신뢰",
    "religion_type": "종교·가치 정렬(소프트)",
}


def rank_continuous_axes_for_db(per_dim: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    DB·관리자 UI용: 각 리커트 축의 근접도(0~100, 높을수록 값이 가까움) 기준 내림차순.
    `manhattan_per_dimension`과 동일 수치를 재정렬한 것이며, 표시 순서만 고정한다.
    """
    rows: list[dict[str, Any]] = []
    for d in per_dim:
        diff = float(d["abs_diff"])
        axis_match = max(0.0, min(100.0, 100.0 * (1.0 - diff / _LIKERT_MAX_DIFF)))
        field = str(d["field"])
        rows.append(
            {
                "field": field,
                "label_ko": AXIS_LABEL_KO.get(field, field),
                "value_A": d["value_A"],
                "value_B": d["value_B"],
                "abs_diff": round(diff, 4),
                "weight": float(d["weight"]),
                "weighted_gap": round(float(d["weighted_gap"]), 4),
                "axis_match_0_100": round(axis_match, 2),
            }
        )
    rows.sort(key=lambda x: float(x["axis_match_0_100"]), reverse=True)
    for i, row in enumerate(rows, 1):
        row["rank"] = i
    return rows


def rank_group_a_components_for_db(
    manhattan_score: float, cosine_score: float, religion_soft_score: float
) -> list[dict[str, Any]]:
    """그룹 A에 들어가는 큰 덩어리 점수(0~100)를 높은 순으로 정렬해 DB에서 바로 쓰기 쉽게 한다."""
    parts = [
        {
            "key": "weighted_manhattan_with_religion_soft",
            "label_ko": "가중 맨하탄(리커트+종교 소프트)",
            "score_0_100": round(float(manhattan_score), 2),
        },
        {
            "key": "weighted_cosine_likert",
            "label_ko": "가중 코사인(리커트)",
            "score_0_100": round(float(cosine_score), 2),
        },
        {
            "key": "religion_soft_only",
            "label_ko": "종교 라벨 정렬(소프트)",
            "score_0_100": round(float(religion_soft_score), 2),
        },
    ]
    parts.sort(key=lambda x: float(x["score_0_100"]), reverse=True)
    for i, p in enumerate(parts, 1):
        p["rank"] = i
    return parts


def _canonical_department(value: Any) -> str | None:
    """양쪽 모두 신뢰 가능한 학과 문자열일 때만 동일 학과 차단을 적용한다."""
    if value is None:
        return None
    s = str(value).strip()
    return s or None


# 한국 나이(출생연도+1 방식)에서 나이 차이 = |출생연도 차이|; 최대 허용 살수.
_MAX_BIRTH_YEAR_GAP = 3
_PARTNER_AGE_PREF_CODES: frozenset[str] = frozenset({"OLDER", "YOUNGER", "SAME_AGE"})


def _parse_birth_year_int(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    try:
        if isinstance(value, str):
            s = value.strip()
            if not s:
                return None
            y = int(s, 10)
        else:
            y = int(value)
    except (TypeError, ValueError):
        return None
    now_y = datetime.now(timezone.utc).year
    if y < 1900 or y > now_y:
        return None
    return y


def _normalize_partner_age_preferences(raw: Any) -> frozenset[str]:
    """선택 없음·비정상 값이면 전체 허용(레거시 호환)."""
    if raw is None:
        return _PARTNER_AGE_PREF_CODES
    if not isinstance(raw, (list, tuple, set)):
        return _PARTNER_AGE_PREF_CODES
    out: set[str] = set()
    for x in raw:
        if x is None:
            continue
        s = str(x).strip().upper()
        if s in _PARTNER_AGE_PREF_CODES:
            out.add(s)
    return frozenset(out) if out else _PARTNER_AGE_PREF_CODES


def _viewer_accepts_partner_birth_year(viewer_year: int, partner_year: int, prefs: frozenset[str]) -> bool:
    """partner가 viewer보다 어떻게 나이 많은지(출생연도 기준·동갑=같은 연도)."""
    if partner_year < viewer_year:
        return "OLDER" in prefs
    if partner_year > viewer_year:
        return "YOUNGER" in prefs
    return "SAME_AGE" in prefs


def _norm_str(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(int(v))
    s = str(v).strip().lower()
    s = re.sub(r"\s+", "_", s)
    return s


def _is_smoker_status(v: Any) -> bool:
    n = _norm_str(v)
    aliases_non = {"0", "non", "none", "never", "no", "false", "n", "비흡연", "비흡연자", "안함"}
    if n in aliases_non:
        return False
    aliases_smoke = {
        "1",
        "2",
        "3",
        "yes",
        "true",
        "y",
        "smoker",
        "smoking",
        "흡연",
        "흡연자",
        "전자담배",
        "가끔",
        "social",
        "light",
    }
    if n in aliases_smoke:
        return True
    try:
        x = int(float(v))
        return x >= 1
    except (TypeError, ValueError):
        return False


def _pref_requires_non_smoker(pref: Any) -> bool:
    n = _norm_str(pref)
    if n in {"", "any", "all", "상관없음", "무관", "no_pref", "dont_care"}:
        return False
    return n in {
        "non_smoker_only",
        "non_only",
        "non_smoker",
        "nonsmoker_only",
        "absolutely_non",
        "absolutely_non_smoker",
        "비흡연만",
        "비흡연_만",
        "비흡연자만",
        "절대_비흡연",
        "no_smoker",
        "no_smoking",
    } or (("non" in n) and ("smok" in n) and ("any" not in n))


def _has_tattoo_status(v: Any) -> bool:
    n = _norm_str(v)
    if n in {"0", "none", "no", "false", "n", "없음", "무", "없다"}:
        return False
    if n in {"1", "yes", "true", "y", "있음", "tattoo", "tattoos"}:
        return True
    try:
        return int(float(v)) >= 1
    except (TypeError, ValueError):
        return bool(v)


def _pref_forbids_tattoo(pref: Any) -> bool:
    n = _norm_str(pref)
    if n in {"", "any", "all", "상관없음", "무관", "no_pref", "dont_care", "none", "no_preference"}:
        return False
    return n in {
        "no_tattoo",
        "forbid",
        "forbidden",
        "타투_금지",
        "타투없음",
        "타투_없음",
        "문신_금지",
        "문신없음",
    } or (("no" in n) and ("tattoo" in n))


def _pref_religion_is_same_only(pref: Any) -> bool:
    n = _norm_str(pref)
    return (("same" in n) and ("only" in n)) or n in {"same", "same_religion", "동일_종교", "같은_종교만"}


def _pref_religion_is_none_partner_only(pref: Any) -> bool:
    n = _norm_str(pref)
    return n in {
        "none_only",
        "no_religion_only",
        "atheist_only",
        "무교만",
        "종교없음만",
        "비종교만",
    } or (("무교" in str(pref)) and ("만" in str(pref)))


def _is_effectively_no_religion(v: Any) -> bool:
    n = _norm_str(v)
    return n in {"", "none", "no", "null", "n/a", "na", "무", "무교", "없음", "atheist", "0"}


def _religion_conflict_same_only(viewer: LifestyleUser, candidate: LifestyleUser) -> bool:
    if not _pref_religion_is_same_only(viewer.pref_religion):
        return False
    a = _norm_str(candidate.religion_type)
    b = _norm_str(viewer.religion_type)
    if not a or not b:
        return False
    return a != b


def _religion_conflict_none_partner_only(viewer: LifestyleUser, candidate: LifestyleUser) -> bool:
    if not _pref_religion_is_none_partner_only(viewer.pref_religion):
        return False
    return not _is_effectively_no_religion(candidate.religion_type)


def _cc_violation(viewer: LifestyleUser, candidate: LifestyleUser) -> bool:
    pref = _norm_str(viewer.pref_cc)
    if pref in {"", "any", "all", "상관없음", "무관", "no_pref"}:
        return False
    cand_cc = candidate.cc
    if cand_cc is None:
        return False
    return _norm_str(cand_cc) != pref


def _weight_vector() -> np.ndarray:
    return np.array([float(CONTINUOUS_WEIGHTS.get(k, 1.0)) for k in CONTINUOUS_KEYS], dtype=np.float64)


def continuous_vectors(u: LifestyleUser) -> np.ndarray:
    return np.array([getattr(u, k) for k in CONTINUOUS_KEYS], dtype=np.float64)


def _continuous_diffs(a: LifestyleUser, b: LifestyleUser) -> np.ndarray:
    diffs: list[float] = []
    for k in CONTINUOUS_KEYS:
        av = float(getattr(a, k))
        bv = float(getattr(b, k))
        if k in _COMPLEMENTARY_LIKERT_KEYS:
            diffs.append(abs((av + bv) - 6.0))
        else:
            diffs.append(abs(av - bv))
    return np.array(diffs, dtype=np.float64)


def _continuous_vectors_for_cosine(a: LifestyleUser, b: LifestyleUser) -> tuple[np.ndarray, np.ndarray]:
    va = continuous_vectors(a)
    vb = continuous_vectors(b)
    for i, k in enumerate(CONTINUOUS_KEYS):
        if k in _COMPLEMENTARY_LIKERT_KEYS:
            vb[i] = 6.0 - vb[i]
    return va, vb


def religion_soft_score_0_100(a: LifestyleUser, b: LifestyleUser) -> tuple[float, dict[str, Any]]:
    """종교 라벨 정렬(하드필터와 별개의 '가치 정렬' 소프트 신호)."""

    ra = _norm_str(a.religion_type)
    rb = _norm_str(b.religion_type)
    a_empty = _is_effectively_no_religion(a.religion_type)
    b_empty = _is_effectively_no_religion(b.religion_type)
    if a_empty and b_empty:
        score = 88.0
        note = "양쪽 모두 무(無) 종교 응답에 가깝습니다."
    elif a_empty ^ b_empty:
        score = 62.0
        note = "한쪽만 종교 응답이 있어 정렬 신호가 다소 약합니다."
    elif ra == rb:
        score = 100.0
        note = "종교(라벨)가 동일합니다."
    else:
        score = 28.0
        note = "종교(라벨)가 다릅니다."
    return score, {"religion_A": ra or None, "religion_B": rb or None, "note": note}


@dataclass(frozen=True)
class HardHit:
    viewer: Literal["A", "B"]
    candidate: Literal["A", "B"]
    rule: str
    constraint_field: str
    state_field: str
    detail: str


def collect_hard_violations(
    a: LifestyleUser,
    b: LifestyleUser,
    *,
    availability_a: list[AvailabilitySlot] | None = None,
    availability_b: list[AvailabilitySlot] | None = None,
    department_a: str | None = None,
    department_b: str | None = None,
    birth_year_a: int | None = None,
    birth_year_b: int | None = None,
    partner_age_preference_a: list[str] | None = None,
    partner_age_preference_b: list[str] | None = None,
) -> list[HardHit]:
    hits: list[HardHit] = []

    da = _canonical_department(department_a)
    db = _canonical_department(department_b)
    if da is not None and db is not None and da == db:
        hits.append(
            HardHit(
                viewer="A",
                candidate="B",
                rule="same_department",
                constraint_field="department",
                state_field="department",
                detail=f"두 사용자의 학과가 동일합니다({da}). 같은 학과끼리는 매칭되지 않습니다.",
            )
        )

    ya = _parse_birth_year_int(birth_year_a)
    yb = _parse_birth_year_int(birth_year_b)
    if ya is not None and yb is not None:
        if abs(ya - yb) > _MAX_BIRTH_YEAR_GAP:
            hits.append(
                HardHit(
                    viewer="A",
                    candidate="B",
                    rule="age_gap_exceeded",
                    constraint_field="birth_year",
                    state_field="birth_year",
                    detail=(
                        f"출생연도 차이가 {_MAX_BIRTH_YEAR_GAP}을 초과합니다"
                        f"(A={ya}, B={yb}, 허용: 한국나이 기준 최대 {_MAX_BIRTH_YEAR_GAP}살 차이까지)."
                    ),
                )
            )
        prefs_a = _normalize_partner_age_preferences(partner_age_preference_a)
        if not _viewer_accepts_partner_birth_year(ya, yb, prefs_a):
            hits.append(
                HardHit(
                    viewer="A",
                    candidate="B",
                    rule="partner_age_preference",
                    constraint_field="partner_age_preference",
                    state_field="birth_year",
                    detail=(
                        f"{ya}생(A)의 상대 연령 선택(연상·동갑·연하)에 맞지 않습니다"
                        f"(상대 출생연도 {yb})."
                    ),
                )
            )
        prefs_b = _normalize_partner_age_preferences(partner_age_preference_b)
        if not _viewer_accepts_partner_birth_year(yb, ya, prefs_b):
            hits.append(
                HardHit(
                    viewer="B",
                    candidate="A",
                    rule="partner_age_preference",
                    constraint_field="partner_age_preference",
                    state_field="birth_year",
                    detail=(
                        f"{yb}생(B)의 상대 연령 선택(연상·동갑·연하)에 맞지 않습니다"
                        f"(상대 출생연도 {ya})."
                    ),
                )
            )

    def check(viewer: LifestyleUser, cand: LifestyleUser, v_lit: Literal["A", "B"], c_lit: Literal["A", "B"]) -> None:
        mpv = get_match_profile(viewer)
        ps = pref_level(viewer, "pref_smoking") if mpv else None
        if ps is not None:
            rules = survey_semantics()["preference_policies"]["pref_smoking"]["hard_rules"]
            sc = partner_smoking_code(cand)
            if ps == 1 and sc >= int(rules.get("level_1_violation_if_smoking_code_gte", 1)):
                hits.append(
                    HardHit(
                        viewer=v_lit,
                        candidate=c_lit,
                        rule="smoking",
                        constraint_field="pref_smoking",
                        state_field="smoking",
                        detail=f"{v_lit}의 흡연 선호(시맨틱 단계 1·절대 비흡연)과 {c_lit}의 흡연 코드({sc})가 충돌합니다.",
                    )
                )
            if ps == 5 and sc < int(rules.get("level_5_violation_if_smoking_code_lt", 2)):
                hits.append(
                    HardHit(
                        viewer=v_lit,
                        candidate=c_lit,
                        rule="smoking",
                        constraint_field="pref_smoking",
                        state_field="smoking",
                        detail=f"{v_lit}는 흡연 파트너만(시맨틱 단계 5) 허용하지만 {c_lit}의 흡연 코드({sc})가 맞지 않습니다.",
                    )
                )
        elif _pref_requires_non_smoker(viewer.pref_smoking) and _is_smoker_status(cand.smoking):
            hits.append(
                HardHit(
                    viewer=v_lit,
                    candidate=c_lit,
                    rule="smoking",
                    constraint_field="pref_smoking",
                    state_field="smoking",
                    detail=f"{v_lit}의 pref_smoking(비흡연 요구)과 {c_lit}의 smoking(흡연/간헐 흡연)이 상호 배타적입니다.",
                )
            )

        pt = pref_level(viewer, "pref_tattoo") if mpv else None
        if pt is not None:
            tr = survey_semantics()["preference_policies"]["pref_tattoo"]["hard_rules"]
            tc = partner_tattoo_code(cand)
            if pt == 1 and tc >= int(tr.get("level_1_violation_if_tattoo_code_gte", 1)):
                hits.append(
                    HardHit(
                        viewer=v_lit,
                        candidate=c_lit,
                        rule="tattoo",
                        constraint_field="pref_tattoo",
                        state_field="tattoo",
                        detail=f"{v_lit}의 타투 선호(시맨틱 단계 1)와 {c_lit}의 타투 코드({tc})가 충돌합니다.",
                    )
                )
            if pt == 5 and tc < int(tr.get("level_5_violation_if_tattoo_code_lt", 2)):
                hits.append(
                    HardHit(
                        viewer=v_lit,
                        candidate=c_lit,
                        rule="tattoo",
                        constraint_field="pref_tattoo",
                        state_field="tattoo",
                        detail=f"{v_lit}는 타투·문신이 있는 파트너만(시맨틱 단계 5) 허용하지만 {c_lit}의 타투 코드({tc})가 맞지 않습니다.",
                    )
                )
        elif _pref_forbids_tattoo(viewer.pref_tattoo) and _has_tattoo_status(cand.tattoo):
            hits.append(
                HardHit(
                    viewer=v_lit,
                    candidate=c_lit,
                    rule="tattoo",
                    constraint_field="pref_tattoo",
                    state_field="tattoo",
                    detail=f"{v_lit}의 pref_tattoo(타투 불가)와 {c_lit}의 tattoo(타투 있음)가 충돌합니다.",
                )
            )

        pr = pref_level(viewer, "pref_religion") if mpv else None
        if mpv and pr is not None:
            if pr == 1:
                va = _norm_str(viewer.religion_type)
                ca = _norm_str(cand.religion_type)
                if not va or not ca or va != ca:
                    hits.append(
                        HardHit(
                            viewer=v_lit,
                            candidate=c_lit,
                            rule="religion_same_only",
                            constraint_field="pref_religion",
                            state_field="religion_type",
                            detail=f"{v_lit}의 pref_religion(동일 종교만·시맨틱)과 {c_lit}의 religion_type이 일치하지 않습니다.",
                        )
                    )
            elif pr == 5:
                if not _is_effectively_no_religion(cand.religion_type):
                    hits.append(
                        HardHit(
                            viewer=v_lit,
                            candidate=c_lit,
                            rule="religion_none_partner_only",
                            constraint_field="pref_religion",
                            state_field="religion_type",
                            detail=f"{v_lit}의 pref_religion(무교·비종교 파트너만·시맨틱)과 {c_lit}의 religion_type이 충돌합니다.",
                        )
                    )
            elif pr == 6:
                if _is_effectively_no_religion(cand.religion_type):
                    hits.append(
                        HardHit(
                            viewer=v_lit,
                            candidate=c_lit,
                            rule="religion_religious_partner_required",
                            constraint_field="pref_religion",
                            state_field="religion_type",
                            detail=f"{v_lit}는 종교가 있는 파트너만(시맨틱 단계 6) 허용하지만 {c_lit}는 무(無) 종교에 가깝습니다.",
                        )
                    )
        else:
            if _religion_conflict_same_only(viewer, cand):
                hits.append(
                    HardHit(
                        viewer=v_lit,
                        candidate=c_lit,
                        rule="religion_same_only",
                        constraint_field="pref_religion",
                        state_field="religion_type",
                        detail=f"{v_lit}의 pref_religion(동일 종교만)과 {c_lit}의 religion_type이 일치하지 않습니다.",
                    )
                )
            if _religion_conflict_none_partner_only(viewer, cand):
                hits.append(
                    HardHit(
                        viewer=v_lit,
                        candidate=c_lit,
                        rule="religion_none_partner_only",
                        constraint_field="pref_religion",
                        state_field="religion_type",
                        detail=f"{v_lit}의 pref_religion(무교·비종교 파트너만)과 {c_lit}의 religion_type이 충돌합니다.",
                    )
                )

        pcl = pref_level(viewer, "pref_cc") if mpv else None
        if pcl is None:
            if _cc_violation(viewer, cand):
                hits.append(
                    HardHit(
                        viewer=v_lit,
                        candidate=c_lit,
                        rule="pref_cc",
                        constraint_field="pref_cc",
                        state_field="cc",
                        detail=f"{v_lit}의 pref_cc와 {c_lit}의 cc 값이 엄격 일치하지 않습니다.",
                    )
                )
        elif pcl == 1:
            if _cc_violation(viewer, cand):
                hits.append(
                    HardHit(
                        viewer=v_lit,
                        candidate=c_lit,
                        rule="pref_cc",
                        constraint_field="pref_cc",
                        state_field="cc",
                        detail=f"{v_lit}의 pref_cc(시맨틱 단계 1·엄격 일치)와 {c_lit}의 cc가 일치하지 않습니다.",
                    )
                )

    check(a, b, "A", "B")
    check(b, a, "B", "A")

    # 시간: HTTP에서 `availability_a`/`availability_b`가 모두 올 때만 적용(구 calculate-match 호환).
    # 배치는 항상 두 리스트를내며, 양쪽 []이면 레거시로 시간축 검사 생략.
    if availability_a is not None and availability_b is not None:
        if not availability_pair_compatible_for_matching(availability_a, availability_b):
            hits.append(
                HardHit(
                    viewer="A",
                    candidate="B",
                    rule="availability_mismatch",
                    constraint_field="availability",
                    state_field="availability",
                    detail="만남 가능 시간(동일 날짜·동일 1시간 time_slot)의 교집합이 없거나, 한쪽만 일정이 있어 동시 만남을 확정할 수 없습니다.",
                )
            )
    return hits


def score_group_a_weighted_manhattan(
    a: LifestyleUser,
    b: LifestyleUser,
    rel_score: float,
    w_rel: float,
    *,
    axis_breakdown: bool = True,
) -> tuple[float, dict[str, Any]]:
    w = _weight_vector()
    va = continuous_vectors(a)
    vb = continuous_vectors(b)
    diffs = _continuous_diffs(a, b)
    likert_num = float(np.sum(w * (1.0 - diffs / _LIKERT_MAX_DIFF)))
    likert_den = float(np.sum(w))
    rel_01 = max(0.0, min(1.0, rel_score / 100.0))
    combined_num = likert_num + w_rel * rel_01
    combined_den = likert_den + w_rel
    manhattan_100 = 100.0 * (combined_num / combined_den) if combined_den > 0 else 0.0

    if not axis_breakdown:
        return manhattan_100, {
            "manhattan_score_0_100": manhattan_100,
            "likert_weight_sum": likert_den,
            "religion_soft_weight": w_rel,
            "religion_soft_score_0_100": rel_score,
        }

    per_dim = [
        {
            "field": k,
            "value_A": int(va[i]),
            "value_B": int(vb[i]),
            "abs_diff": float(diffs[i]),
            "weight": float(w[i]),
            "weighted_gap": float(w[i] * diffs[i]),
            "match_mode": "complementary_sum_to_6" if k in _COMPLEMENTARY_LIKERT_KEYS else "same_value",
        }
        for i, k in enumerate(CONTINUOUS_KEYS)
    ]
    by_weighted_gap = sorted(per_dim, key=lambda x: x["weighted_gap"], reverse=True)
    worst_list = by_weighted_gap[:5]
    best = list(reversed(by_weighted_gap))[:5]
    return manhattan_100, {
        "manhattan_score_0_100": manhattan_100,
        "likert_weight_sum": likert_den,
        "religion_soft_weight": w_rel,
        "religion_soft_score_0_100": rel_score,
        "per_dimension": per_dim,
        "best_aligned": best,
        "worst_aligned": worst_list,
    }


def score_group_a_weighted_cosine(a: LifestyleUser, b: LifestyleUser) -> tuple[float, dict[str, Any]]:
    w = _weight_vector()
    raw_a, raw_b = _continuous_vectors_for_cosine(a, b)
    va = (raw_a - 3.0) * np.sqrt(w)
    vb = (raw_b - 3.0) * np.sqrt(w)
    denom = float(np.linalg.norm(va) * np.linalg.norm(vb))
    if denom <= 0:
        cos = 1.0 if float(np.linalg.norm(va - vb)) == 0.0 else 0.0
    else:
        cos = float(np.dot(va, vb) / denom)
    cos = max(0.0, min(1.0, cos))
    cosine_100 = 100.0 * cos
    return cosine_100, {
        "cosine_similarity": cos,
        "cosine_score_0_100": cosine_100,
        "centering": 3.0,
        "weights": "sqrt(weight) per axis",
        "complementary_axes_flipped_for_B": sorted(_COMPLEMENTARY_LIKERT_KEYS),
    }


def _rule_label_ko(rule: str) -> str:
    return {
        "smoking": "흡연 조건",
        "tattoo": "타투·문신 조건",
        "religion_same_only": "종교(동일 종교만)",
        "religion_none_partner_only": "종교(무교·비종교만)",
        "religion_religious_partner_required": "종교(파트너 종교 필요)",
        "pref_cc": "기타(pref_cc)",
        "availability_mismatch": "만남 가능 시간",
        "same_department": "동일 학과",
        "age_gap_exceeded": "나이 차이(출생연도)",
        "partner_age_preference": "상대 연령(연상·동갑·연하)",
    }.get(rule, rule)


def build_summary_text(
    match_status: Literal["ok", "violated"],
    final_score: float,
    group_a_score: float,
    violations: list[dict[str, Any]],
    worst_aligned: list[dict[str, Any]],
    best_aligned: list[dict[str, Any]],
) -> str:
    if match_status == "violated":
        rules = [str(v.get("rule", "")) for v in violations]
        if "religion_religious_partner_required" in rules:
            s1 = "상대에게 종교가 있어야 한다는 조건과 맞지 않아 매칭이 권장되지 않습니다."
        elif any(str(r).startswith("religion") for r in rules):
            s1 = "종교적 가치관·수용 조건의 차이로 매칭이 권장되지 않습니다."
        elif "smoking" in rules:
            s1 = "흡연 선호(pref_smoking)와 상대의 실제 흡연(smoking)이 맞지 않아 매칭이 권장되지 않습니다."
        elif "tattoo" in rules:
            s1 = "타투·문신 관련 수용 조건과 상대 상태가 맞지 않아 매칭이 권장되지 않습니다."
        elif "pref_cc" in rules:
            s1 = "기타(pref_cc) 조건과 상대(cc) 정보가 맞지 않아 매칭이 권장되지 않습니다."
        elif "availability_mismatch" in rules:
            s1 = "만남 가능 시간이 겹치지 않거나 한쪽만 일정이 있어 동시 만남이 어렵습니다."
        elif "same_department" in rules:
            s1 = "같은 학과끼리는 매칭되지 않는 정책에 해당합니다."
        elif "age_gap_exceeded" in rules:
            s1 = "허용된 나이 차이를 넘어 매칭이 권장되지 않습니다."
        elif "partner_age_preference" in rules:
            s1 = "만날 상대 연령(연상·동갑·연하) 조건과 맞지 않아 매칭이 권장되지 않습니다."
        else:
            s1 = "상호 배타적인 하드 필터가 감지되어 매칭이 권장되지 않습니다."
        if len(violations) > 1:
            labels = "·".join(_rule_label_ko(r) for r in dict.fromkeys(rules))
            s2 = f"누적 {len(violations)}건의 위반이 있습니다({labels}). 수용 조건과 본인 상태를 함께 점검해 주세요."
            return f"{s1} {s2}"
        return s1

    worst = worst_aligned[0] if worst_aligned else None
    best = best_aligned[0] if best_aligned else None
    worst_label = AXIS_LABEL_KO.get(str(worst["field"]), "특정 항목") if worst else "특정 항목"
    best_label = AXIS_LABEL_KO.get(str(best["field"]), "여러 항목") if best else "여러 항목"

    if final_score >= 82.0:
        return (
            f"두 분은 가중 설문 기준으로도 높은 정렬도(최종 {final_score:.0f}점)를 보입니다. "
            f"특히 「{best_label}」 축에서 가장 잘 맞습니다."
        )
    if final_score >= 65.0:
        return (
            f"전반적으로 무난한 궁합(최종 {final_score:.0f}점)이며, 「{best_label}」에서 강점이 보입니다. "
            f"다만 「{worst_label}」에서 상대적 격차가 있으니 만남 전에 기대치를 맞추면 좋습니다."
        )
    return (
        f"현재 점수는 {final_score:.0f}점으로 다소 낮은 편입니다. "
        f"「{worst_label}」 등에서 차이가 커 보이므로, 가치관·생활 리듬을 대화로 조율하는 것이 필요합니다."
    )


def build_numbered_reasons_ko(
    match_status: Literal["ok", "violated"],
    final_score: float,
    violations: list[dict[str, Any]],
    axes_ranked: list[dict[str, Any]],
    components_ranked: list[dict[str, Any]],
) -> tuple[list[str], str, str]:
    """
    DB·어드민 표시용: '이유1: …', '이유2: …' 형태.
    배열 + 줄바꿈 연결 + 한 줄(공백 구분)을 함께 반환한다.
    """
    bodies: list[str] = []
    if match_status == "violated":
        for v in violations[:8]:
            rule = _rule_label_ko(str(v.get("rule", "")))
            detail = str(v.get("detail", "")).strip()
            if len(detail) > 220:
                detail = detail[:217] + "..."
            bodies.append(f"하드 필터 위반({rule}). {detail}")
        if not bodies:
            bodies.append("하드 필터 위반으로 이 쌍은 매칭에서 제외됩니다.")
    else:
        bodies.append(f"최종 궁합 점수는 {final_score:.1f}점입니다.")
        if axes_ranked:
            top = axes_ranked[0]
            bodies.append(
                f"「{top['label_ko']}」에서 응답이 가장 가깝습니다(정렬도 {float(top['axis_match_0_100']):.0f}/100, A={top['value_A']}, B={top['value_B']})."
            )
        if len(axes_ranked) >= 2:
            t2 = axes_ranked[1]
            bodies.append(f"「{t2['label_ko']}」에서도 정렬이 좋습니다({float(t2['axis_match_0_100']):.0f}/100).")
        if components_ranked:
            c0 = components_ranked[0]
            bodies.append(f"{c0['label_ko']} 점수가 상대적으로 가장 높습니다({float(c0['score_0_100']):.1f}점).")
        if final_score < 72.0 and axes_ranked:
            worst = axes_ranked[-1]
            bodies.append(
                f"「{worst['label_ko']}」는 격차가 큰 편입니다({float(worst['axis_match_0_100']):.0f}/100), 기대치 조율이 필요합니다."
            )

    lines = [f"이유{i}: {t}" for i, t in enumerate(bodies, 1)]
    joined_nl = "\n".join(lines)
    joined_sp = " ".join(lines)
    return lines, joined_nl, joined_sp


def compute_match(
    a: LifestyleUser,
    b: LifestyleUser,
    *,
    availability_a: list[AvailabilitySlot] | None = None,
    availability_b: list[AvailabilitySlot] | None = None,
    department_a: str | None = None,
    department_b: str | None = None,
    birth_year_a: int | None = None,
    birth_year_b: int | None = None,
    partner_age_preference_a: list[str] | None = None,
    partner_age_preference_b: list[str] | None = None,
    # 배치 매칭 후보 루프: 점수·하드만 필요 per-axis·긴 문구 생략으로 메모리·GC 부담 완화.
    batch_candidate_pass: bool = False,
) -> dict[str, Any]:
    hits = collect_hard_violations(
        a,
        b,
        availability_a=availability_a,
        availability_b=availability_b,
        department_a=department_a,
        department_b=department_b,
        birth_year_a=birth_year_a,
        birth_year_b=birth_year_b,
        partner_age_preference_a=partner_age_preference_a,
        partner_age_preference_b=partner_age_preference_b,
    )
    n_hits = len(hits)

    violations_out = [
        {
            "viewer": h.viewer,
            "candidate": h.candidate,
            "rule": h.rule,
            "constraint_field": h.constraint_field,
            "state_field": h.state_field,
            "detail": h.detail,
        }
        for h in hits
    ]

    if n_hits > 0:
        match_status: Literal["ok", "violated"] = "violated"
        final_score = 0.0
        group_b_penalty = 100.0
        group_a_score = 0.0
        soft_entries: list[dict[str, Any]] = []
        soft_total = 0.0

        if batch_candidate_pass:
            sem_v = int(survey_semantics().get("version", 1))
            return {
                "final_score": round(final_score, 2),
                "match_status": match_status,
                "group_a_score": round(group_a_score, 2),
                "group_b_penalty": round(group_b_penalty, 2),
                "match_report": {
                    "batch_candidate_pass_only": True,
                    "group_a": {"score_0_100": round(group_a_score, 2)},
                    "group_b": {
                        "violations": violations_out,
                        "violation_count": n_hits,
                        "strict_mode": True,
                        "total_penalty_applied": round(group_b_penalty, 2),
                    },
                    "semantics": {
                        "survey_schema_version": sem_v,
                        "soft_penalties": soft_entries,
                        "soft_penalty_total": round(soft_total, 2),
                    },
                },
            }

        w_rel = float(RELIGION_SOFT_WEIGHT)
        w_sum = float(np.sum(_weight_vector()))
        match_report_v: dict[str, Any] = {
            "summary_text": "",
            "continuous_axes_ranked_desc": [],
            "group_a_component_scores_ranked_desc": [],
            "group_a": {
                "score_0_100": 0.0,
                "likert_component_0_100": 0.0,
                "blend": "mean(weighted_manhattan_with_religion_soft, weighted_cosine_likert_only)",
                "continuous_weights": {k: float(CONTINUOUS_WEIGHTS.get(k, 1.0)) for k in CONTINUOUS_KEYS},
                "religion_soft": {
                    "weight": w_rel,
                    "score_0_100": 0.0,
                    "note": "하드 필터 위반으로 연속형·종교 소프트 점수를 계산하지 않았습니다.",
                },
                "manhattan": {
                    "manhattan_score_0_100": 0.0,
                    "likert_weight_sum": w_sum,
                    "religion_soft_weight": w_rel,
                    "religion_soft_score_0_100": 0.0,
                },
                "cosine": {
                    "cosine_similarity": 0.0,
                    "cosine_score_0_100": 0.0,
                    "centering": 3.0,
                    "weights": "sqrt(weight) per axis",
                    "complementary_axes_flipped_for_B": sorted(_COMPLEMENTARY_LIKERT_KEYS),
                },
                "manhattan_per_dimension": [],
                "best_aligned": [],
                "worst_aligned": [],
            },
            "group_b": {
                "violations": violations_out,
                "violation_count": n_hits,
                "strict_mode": True,
                "total_penalty_applied": round(group_b_penalty, 2),
            },
            "highlights": {
                "top_match_axes": [],
                "largest_gaps": [],
                "top_axes_by_match_score": [],
                "bottom_axes_by_match_score": [],
            },
            "semantics": {
                "survey_schema_version": int(survey_semantics().get("version", 1)),
                "soft_penalties": soft_entries,
                "soft_penalty_total": round(soft_total, 2),
            },
        }
        match_report_v["summary_text"] = build_summary_text(
            match_status, final_score, group_a_score, violations_out, [], []
        )
        reasons_list_v, reasons_nl_v, reasons_1l_v = build_numbered_reasons_ko(
            match_status, final_score, violations_out, [], []
        )
        match_report_v["reasons_numbered_ko"] = reasons_list_v
        match_report_v["reasons_joined_ko"] = reasons_nl_v
        match_report_v["reasons_one_line_ko"] = reasons_1l_v
        return {
            "final_score": round(final_score, 2),
            "match_status": match_status,
            "group_a_score": round(group_a_score, 2),
            "group_b_penalty": round(group_b_penalty, 2),
            "match_report": match_report_v,
        }

    rel_score, rel_meta = religion_soft_score_0_100(a, b)
    w_rel = float(RELIGION_SOFT_WEIGHT)

    m_score, m_report = score_group_a_weighted_manhattan(
        a, b, rel_score, w_rel, axis_breakdown=not batch_candidate_pass
    )
    c_score, c_report = score_group_a_weighted_cosine(a, b)

    w = _weight_vector()
    diffs = _continuous_diffs(a, b)
    likert_den = float(np.sum(w))
    likert_manhattan_only = (
        100.0 * float(np.sum(w * (1.0 - diffs / _LIKERT_MAX_DIFF))) / likert_den if likert_den > 0 else 0.0
    )
    group_a_likert_only = float((likert_manhattan_only + c_score) / 2.0)
    group_a_score = float((m_score + c_score) / 2.0)

    soft_entries = collect_soft_penalty_entries(a, b)
    soft_total = sum(float(e["points"]) for e in soft_entries)

    match_status = "ok"
    base_score = max(0.0, min(100.0, group_a_score))
    final_score = max(0.0, min(100.0, base_score - soft_total))
    group_b_penalty = 0.0

    if batch_candidate_pass:
        sem_v = int(survey_semantics().get("version", 1))
        return {
            "final_score": round(final_score, 2),
            "match_status": match_status,
            "group_a_score": round(group_a_score, 2),
            "group_b_penalty": round(group_b_penalty, 2),
            "match_report": {
                "batch_candidate_pass_only": True,
                "group_a": {"score_0_100": round(group_a_score, 2)},
                "group_b": {
                    "violations": violations_out,
                    "violation_count": n_hits,
                    "strict_mode": True,
                    "total_penalty_applied": round(group_b_penalty, 2),
                },
                "semantics": {
                    "survey_schema_version": sem_v,
                    "soft_penalties": soft_entries,
                    "soft_penalty_total": round(soft_total, 2),
                },
            },
        }

    axes_ranked = rank_continuous_axes_for_db(m_report["per_dimension"])
    components_ranked = rank_group_a_components_for_db(m_score, c_score, rel_score)

    match_report: dict[str, Any] = {
        "summary_text": "",
        # DB·어드민: 정렬 고정(별도 정렬 없이 그대로 표시 가능)
        "continuous_axes_ranked_desc": axes_ranked,
        "group_a_component_scores_ranked_desc": components_ranked,
        "group_a": {
            "score_0_100": round(group_a_score, 2),
            "likert_component_0_100": round(group_a_likert_only, 2),
            "blend": "mean(weighted_manhattan_with_religion_soft, weighted_cosine_likert_only)",
            "continuous_weights": {k: float(CONTINUOUS_WEIGHTS.get(k, 1.0)) for k in CONTINUOUS_KEYS},
            "religion_soft": {**rel_meta, "weight": w_rel, "score_0_100": round(rel_score, 2)},
            "manhattan": {k: v for k, v in m_report.items() if k not in ("per_dimension", "best_aligned", "worst_aligned")},
            "cosine": {k: round(v, 4) if isinstance(v, float) else v for k, v in c_report.items()},
            "manhattan_per_dimension": m_report["per_dimension"],
            "best_aligned": m_report["best_aligned"],
            "worst_aligned": m_report["worst_aligned"],
        },
        "group_b": {
            "violations": violations_out,
            "violation_count": n_hits,
            "strict_mode": True,
            "total_penalty_applied": round(group_b_penalty, 2),
        },
        "highlights": {
            "top_match_axes": m_report["best_aligned"],
            "largest_gaps": m_report["worst_aligned"],
            # 축 요약도 동일 기준(정렬도 높은 순)으로 맞춤
            "top_axes_by_match_score": axes_ranked[:5],
            "bottom_axes_by_match_score": list(reversed(axes_ranked))[:5],
        },
        "semantics": {
            "survey_schema_version": int(survey_semantics().get("version", 1)),
            "soft_penalties": soft_entries,
            "soft_penalty_total": round(soft_total, 2),
        },
    }

    match_report["summary_text"] = build_summary_text(
        match_status,
        final_score,
        group_a_score,
        violations_out,
        m_report["worst_aligned"],
        m_report["best_aligned"],
    )
    reasons_list, reasons_nl, reasons_1l = build_numbered_reasons_ko(
        match_status,
        final_score,
        violations_out,
        axes_ranked,
        components_ranked,
    )
    if soft_entries:
        idx = len(reasons_list) + 1
        extra_body = (
            f"선호(소프트) 조정 {len(soft_entries)}건, 합계 {soft_total:.1f}점 감점 "
            f"(세부: match_report.semantics.soft_penalties)."
        )
        reasons_list = [*reasons_list, f"이유{idx}: {extra_body}"]
        reasons_nl = "\n".join(reasons_list)
        reasons_1l = " ".join(reasons_list)
    match_report["reasons_numbered_ko"] = reasons_list
    match_report["reasons_joined_ko"] = reasons_nl
    match_report["reasons_one_line_ko"] = reasons_1l

    return {
        "final_score": round(final_score, 2),
        "match_status": match_status,
        "group_a_score": round(group_a_score, 2),
        "group_b_penalty": round(group_b_penalty, 2),
        "match_report": match_report,
    }
