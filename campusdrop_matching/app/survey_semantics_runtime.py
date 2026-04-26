"""
`config/surveySemantics.v1.json` 로딩 및 match_profile 기반 파생 값.
Node가 저장·전달한 `matchProfile`을 snake_case `match_profile`로 받는다.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.schemas import LifestyleUser


@lru_cache(maxsize=1)
def survey_semantics() -> dict[str, Any]:
    configured = os.getenv("SURVEY_SEMANTICS_PATH")
    here = Path(__file__).resolve()
    candidates = [
        Path(configured) if configured else None,
        # Docker image layout: /app/app/*.py + /app/config/*.json
        here.parents[1] / "config" / "surveySemantics.v1.json",
        # Local repo layout: campusdrop_matching/app/*.py + config/*.json
        here.parents[2] / "config" / "surveySemantics.v1.json",
    ]
    for path in candidates:
        if path is not None and path.exists():
            with path.open(encoding="utf-8") as f:
                return json.load(f)
    checked = ", ".join(str(path) for path in candidates if path is not None)
    raise FileNotFoundError(f"surveySemantics.v1.json not found. Checked: {checked}")


def get_match_profile(u: LifestyleUser) -> dict[str, Any] | None:
    mp = getattr(u, "match_profile", None)
    return mp if isinstance(mp, dict) else None


def _smoking_label_to_code(label: Any) -> int | None:
    if not isinstance(label, str):
        return None
    m = survey_semantics()["choice_label_maps"]["smoking"]
    return int(m[label]) if label.strip() in m else None


def partner_smoking_code(c: LifestyleUser) -> int:
    mp = get_match_profile(c)
    if mp and isinstance(mp.get("smoking"), dict) and "code" in mp["smoking"]:
        return int(mp["smoking"]["code"])
    hit = _smoking_label_to_code(c.smoking)
    if hit is not None:
        return hit
    return 2 if _legacy_is_smoker_binary(c.smoking) else 0


def _legacy_is_smoker_binary(smoking: Any) -> bool:
    """레거시: 카탈로그에 없는 문자열일 때만 사용(시드 호환)."""
    if smoking is None:
        return False
    if isinstance(smoking, str):
        s = smoking.strip().lower()
        if s in ("비흡연", "비흡연자", "안함", "0", "none", "no", "false", "n"):
            return False
        if s in ("흡연", "흡연자", "전자담배만", "가끔", "yes", "true", "y", "smoker", "smoking"):
            return True
    try:
        return int(float(smoking)) >= 1
    except (TypeError, ValueError):
        return bool(smoking)


def partner_tattoo_code(c: LifestyleUser) -> int:
    mp = get_match_profile(c)
    if mp and isinstance(mp.get("tattoo"), dict) and "code" in mp["tattoo"]:
        return int(mp["tattoo"]["code"])
    m = survey_semantics()["choice_label_maps"]["tattoo"]
    if isinstance(c.tattoo, str) and c.tattoo.strip() in m:
        return int(m[c.tattoo.strip()])
    return 2 if _legacy_has_tattoo_binary(c.tattoo) else 0


def _legacy_has_tattoo_binary(tattoo: Any) -> bool:
    if tattoo is None:
        return False
    if isinstance(tattoo, str):
        s = tattoo.strip().lower()
        if s in ("0", "none", "no", "false", "n", "없음", "무", "없다"):
            return False
        if s in ("1", "yes", "true", "y", "있음", "tattoo", "tattoos"):
            return True
    try:
        return int(float(tattoo)) >= 1
    except (TypeError, ValueError):
        return bool(tattoo)


def pref_level(u: LifestyleUser, key: str) -> int | None:
    mp = get_match_profile(u)
    if not mp:
        return None
    block = mp.get(key)
    if not isinstance(block, dict):
        return None
    if "level" not in block:
        return None
    return int(block["level"])


def pref_cc_tier(u: LifestyleUser) -> str | None:
    mp = get_match_profile(u)
    if not mp or not isinstance(mp.get("pref_cc"), dict):
        return None
    t = mp["pref_cc"].get("tier")
    return str(t) if t is not None else None


def collect_soft_penalty_entries(a: LifestyleUser, b: LifestyleUser) -> list[dict[str, Any]]:
    """선호 단계 기반 소프트 페널티(하드 위반과 별개)."""
    spec = survey_semantics()
    out: list[dict[str, Any]] = []

    def add(rule: str, points: float, detail: str, affected: str) -> None:
        if points <= 0:
            return
        out.append({"rule": rule, "points": round(float(points), 2), "detail": detail, "affected_pair": affected})

    # A의 선호 vs B의 상태 (양방향 동일 패턴으로 확장 가능 — 현재 제품은 주로 단방향 설명)
    for viewer, cand, v_lit, c_lit in ((a, b, "A", "B"), (b, a, "B", "A")):
        ps = pref_level(viewer, "pref_smoking")
        if ps == 2:
            row = next(
                (x for x in spec["preference_policies"]["pref_smoking"]["levels"] if int(x["id"]) == 2),
                None,
            )
            if row and partner_smoking_code(cand) >= int(row.get("soft_penalty_if_partner_smoking_code_gte", 99)):
                add(
                    "pref_smoking_soft_prefer_non",
                    float(row.get("penalty_points", 12)),
                    f"{v_lit}는 비흡연을 선호(소프트)하지만 {c_lit}의 흡연 코드가 높습니다.",
                    f"{v_lit}-{c_lit}",
                )
        if ps == 4:
            row = next(
                (x for x in spec["preference_policies"]["pref_smoking"]["levels"] if int(x["id"]) == 4),
                None,
            )
            thr = int(row.get("soft_penalty_if_partner_smoking_code_eq", 0)) if row else 0
            if row and partner_smoking_code(cand) == thr:
                add(
                    "pref_smoking_soft_prefer_smoker",
                    float(row.get("penalty_points", 8)),
                    f"{v_lit}는 흡연 쪽을 선호(소프트)하지만 {c_lit}는 비흡연에 가깝습니다.",
                    f"{v_lit}-{c_lit}",
                )

        pt = pref_level(viewer, "pref_tattoo")
        if pt == 2:
            row = next(
                (x for x in spec["preference_policies"]["pref_tattoo"]["levels"] if int(x["id"]) == 2),
                None,
            )
            if row and partner_tattoo_code(cand) >= int(row.get("soft_penalty_if_partner_tattoo_code_gte", 99)):
                add(
                    "pref_tattoo_soft_prefer_none",
                    float(row.get("penalty_points", 10)),
                    f"{v_lit}는 타투 없음을 선호(소프트)하지만 {c_lit}의 타투 코드가 높습니다.",
                    f"{v_lit}-{c_lit}",
                )

        pc = pref_level(viewer, "pref_cc")
        if pc == 2:
            row = next(
                (x for x in spec["preference_policies"]["pref_cc"]["levels"] if int(x["id"]) == 2),
                None,
            )
            pref_s = str(viewer.pref_cc or "").strip()
            cand_cc = cand.cc
            if cand_cc is not None and str(cand_cc).strip() != pref_s:
                add(
                    "pref_cc_soft_similar",
                    float(row.get("penalty_points", 8)) if row else 8.0,
                    f"{v_lit}의 pref_cc와 {c_lit}의 cc가 일치하지 않습니다(소프트).",
                    f"{v_lit}-{c_lit}",
                )

    return out
