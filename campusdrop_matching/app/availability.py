"""
만남 가능 시간(availability) 겹침 — DB에 저장된 `date`(YYYY-MM-DD) + `time_slot`(정확히 1시간, 예 11:00-12:00) 문자열 기준.

정책(배치·calculate-match에서 `availability_*`가 모두 전달될 때, 정책 B의 1단계와 동일):
- 양쪽 슬롯이 모두 0개: 레거시/수동 데이터 호환 — 시간축에서 막지 않음.
- 한쪽만 슬롯이 있음: 상대 가능 시간이 불명해 동시 만남을 검증할 수 없음 → 비호환.
- 양쪽 모두 1개 이상: 정규화 키 `date + \"\\t\" + time_slot` 교집합이 1개 이상일 때만 호환.
"""

from __future__ import annotations

from collections.abc import Sequence

from app.schemas import AvailabilitySlot


def normalized_slot_keys(slots: Sequence[AvailabilitySlot | dict[str, str]]) -> set[str]:
    keys: set[str] = set()
    for raw in slots:
        if isinstance(raw, dict):
            s = AvailabilitySlot.model_validate(raw)
        else:
            s = raw
        keys.add(f"{s.date}\t{s.time_slot}")
    return keys


def availability_overlap_count(
    slots_a: Sequence[AvailabilitySlot | dict[str, str]],
    slots_b: Sequence[AvailabilitySlot | dict[str, str]],
) -> int:
    return len(normalized_slot_keys(slots_a) & normalized_slot_keys(slots_b))


def overlapping_slot_keys(
    slots_a: Sequence[AvailabilitySlot | dict[str, str]],
    slots_b: Sequence[AvailabilitySlot | dict[str, str]],
) -> list[str]:
    return sorted(normalized_slot_keys(slots_a) & normalized_slot_keys(slots_b))


def slot_key_to_availability_slot(slot_key: str) -> AvailabilitySlot | None:
    try:
        date, time_slot = slot_key.split("\t", 1)
    except ValueError:
        return None
    return AvailabilitySlot(date=date, time_slot=time_slot)


def availability_pair_compatible_for_matching(
    slots_a: Sequence[AvailabilitySlot | dict[str, str]],
    slots_b: Sequence[AvailabilitySlot | dict[str, str]],
) -> bool:
    ka = normalized_slot_keys(slots_a)
    kb = normalized_slot_keys(slots_b)
    if len(ka) == 0 and len(kb) == 0:
        return True
    if len(ka) == 0 or len(kb) == 0:
        return False
    return len(ka & kb) > 0
