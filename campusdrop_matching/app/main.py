from __future__ import annotations

import logging
import os

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.batch_match import batch_match_endpoint
from app.matching import compute_match
from app.schemas import (
    BatchMatchRequest,
    BatchMatchResponse,
    CalculateMatchRequest,
    CalculateMatchResponse,
)

app = FastAPI(title="CampusDrop Lifestyle Match", version="1.0.0")
logger = logging.getLogger(__name__)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/calculate-match", response_model=CalculateMatchResponse)
def calculate_match(body: CalculateMatchRequest) -> CalculateMatchResponse:
    result = compute_match(
        body.user_A,
        body.user_B,
        availability_a=body.availability_a,
        availability_b=body.availability_b,
        department_a=body.department_a,
        department_b=body.department_b,
        birth_year_a=body.birth_year_a,
        birth_year_b=body.birth_year_b,
        partner_age_preference_a=body.partner_age_preference_a,
        partner_age_preference_b=body.partner_age_preference_b,
        gender_a=body.gender_a,
        gender_b=body.gender_b,
        hard_rules_scope=body.hard_rules_scope,
    )
    return CalculateMatchResponse.model_validate(result)


@app.post("/batch-match", response_model=BatchMatchResponse)
def batch_match(body: BatchMatchRequest) -> BatchMatchResponse:
    """전체 유저 리스트를 한 번에 받아 쌍·점수를 계산한다(서버 내부에서 전 쌍 연산)."""
    try:
        return batch_match_endpoint(body)
    except Exception:
        logger.exception("batch_match failed (users=%s)", len(body.users))
        raise HTTPException(
            status_code=500,
            detail="batch_match_failed",
        ) from None


if __name__ == "__main__":
    _port = os.getenv("PORT", 8000)
    port = int(_port) if isinstance(_port, str) else _port
    uvicorn.run("app.main:app", host="0.0.0.0", port=port)
