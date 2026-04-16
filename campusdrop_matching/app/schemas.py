from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


CONTINUOUS_KEYS: tuple[str, ...] = (
    "energy",
    "weekend",
    "pattern",
    "trend",
    "alcohol",
    "contact",
    "meeting",
    "planning",
    "affection",
    "date_expense",
    "friends",
    "jealousy",
    "skinship_speed",
    "skinship_limit",
    "date_drinking",
    "religion_intensity",
    "politics",
    "marriage_view",
    "meeting_seriousness",
    "job_view",
    "spending",
    "conflict",
    "empathy",
    "honesty",
    "trust",
)

# 연속형 항목별 가중치 — `config/surveySemantics.v1.json` 의 스케일 weight 와 동기화할 것.
# 키 생략 시 matching.py 에서 1.0으로 간주(CONTINUOUS_KEYS 전부 나열 권장).
CONTINUOUS_WEIGHTS: dict[str, float] = {
    "contact": 2.0,
    "friends": 2.0,
    "conflict": 2.0,
    "skinship_limit": 1.5,
    "trend": 1.5,
    "alcohol": 1.5,
    "date_expense": 1.5,
    "meeting_seriousness": 1.5,
    "empathy": 1.5,
    "honesty": 1.5,
    "trust": 1.5,
    "politics": 1.25,
    "job_view": 1.25,
    "skinship_speed": 1.0,
    "marriage_view": 1.0,
    "spending": 1.0,
    "energy": 1.0,
    "weekend": 1.0,
    "pattern": 1.0,
    "meeting": 1.0,
    "planning": 1.0,
    "affection": 1.0,
    "jealousy": 1.0,
    "date_drinking": 1.0,
    "religion_intensity": 1.0,
}

# religion_type 소프트(맨하탄 블렌드) — 스펙의 religion_soft_score 에 대응.
RELIGION_SOFT_WEIGHT: float = 1.0


class AvailabilitySlot(BaseModel):
    """설문 검증 후 DB에 저장되는 1시간 단위 가능 슬롯."""

    model_config = ConfigDict(extra="forbid")

    date: str
    time_slot: str


class LifestyleUser(BaseModel):
    """32개 키 중 연속형 + 하드필터 + (선택) cc 본인값."""

    model_config = {"extra": "forbid"}

    energy: int
    weekend: int
    pattern: int
    trend: int
    alcohol: int
    contact: int
    meeting: int
    planning: int
    affection: int
    date_expense: int
    friends: int
    jealousy: int
    skinship_speed: int
    skinship_limit: int
    date_drinking: int
    religion_intensity: int
    politics: int
    marriage_view: int
    meeting_seriousness: int
    job_view: int
    spending: int
    conflict: int
    empathy: int
    honesty: int
    trust: int

    smoking: Any
    tattoo: Any
    religion_type: Any
    pref_smoking: Any
    pref_tattoo: Any
    pref_religion: Any
    pref_cc: Any
    cc: Any | None = None
    # Node `matchProfile` — 시맨틱 v1 선호 단계·흡연/타투 코드 등. 없으면 레거시 문자열 규칙.
    match_profile: dict[str, Any] | None = None

    @field_validator(*CONTINUOUS_KEYS)
    @classmethod
    def _likert(cls, v: int) -> int:
        if not isinstance(v, int):
            raise TypeError("연속형 항목은 정수(1~5)여야 합니다.")
        if v < 1 or v > 5:
            raise ValueError("연속형 항목은 1~5 범위여야 합니다.")
        return v


class CalculateMatchRequest(BaseModel):
    """하드 필터는 항상 엄격 적용(violated 시 0점). 구버전 필드는 무시한다."""

    model_config = ConfigDict(extra="ignore")

    user_A: LifestyleUser
    user_B: LifestyleUser
    # 둘 다 생략(None)이면 기존과 같이 시간 겹침을 보지 않음. 둘 다 주어지면 `compute_match`에서 하드 검사.
    availability_a: list[AvailabilitySlot] | None = None
    availability_b: list[AvailabilitySlot] | None = None


class CalculateMatchResponse(BaseModel):
    final_score: float
    match_status: Literal["ok", "violated"]
    group_a_score: float
    group_b_penalty: float
    match_report: dict[str, Any]


class BatchMatchUserEntry(BaseModel):
    """배치 매칭용: 외부 Identity UUID + LifestyleUser 프로필 + 성별(이성 쌍만 엣지 생성)."""

    model_config = ConfigDict(extra="ignore")

    user_id: str
    profile: LifestyleUser
    gender: Literal["male", "female"] | None = None
    # Node가 `Trait.surveyData`에서 추출해 전달. 키 생략 시 [] — 구버전 호출자는 시간 제약 없음(양쪽 []).
    availability: list[AvailabilitySlot] = Field(default_factory=list)


class BatchMatchRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    users: list[BatchMatchUserEntry]
    forbidden_pairs: list[list[str]] = Field(
        default_factory=list,
        description="과거 매칭 쌍. 각 원소는 `[uuid_lo, uuid_hi]`(문자열 정렬). 해당 쌍은 배치 엣지에서 제외.",
    )


class BatchMatchPair(BaseModel):
    user_a_id: str
    user_b_id: str
    score: float
    # `compute_match`의 `match_report` 스냅샷(요약·축별 정렬·위반 목록 등). GET /admin/matches용.
    match_report: dict[str, Any] | None = None


class BatchMatchResponse(BaseModel):
    pairs: list[BatchMatchPair]
