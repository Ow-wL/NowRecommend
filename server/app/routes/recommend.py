from collections.abc import Callable
from functools import lru_cache

import uuid

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from ..ai_engine import engine_for, recommend_ai
from ..budget import BudgetedEmbedder, Gate, allowance_for, take_total
from ..config import Settings, get_settings
from ..db import get_session
from ..embeddings import GeminiEmbedder, QueryEmbedder
from ..llm.client import JsonModel
from ..llm.provider import shared_model
from ..ratelimit import client_address
from ..recommend import PipelineConfig, recommend
from ..schemas import RecommendRequest
from ..stats import count
from .auth import optional_user_id

router = APIRouter()


@lru_cache
def get_query_embedder() -> Callable[[str], list[float]] | None:
    """None without an API key: ranking then uses taste and condition tags only."""
    settings = get_settings()
    if not settings.gemini_api_key:
        return None
    # One attempt with a short timeout: a slow embedding should degrade the ranking, not stall the request.
    # The embedding is a paid call too: a sentence not in the cache is counted against the service's day (budget.py).
    return QueryEmbedder(BudgetedEmbedder(GeminiEmbedder(settings.gemini_api_key, settings.embedding_model, settings.embedding_dim,
                                                         attempts=1, timeout_ms=5000), take_total))


def get_rerank_model() -> JsonModel | None:
    """None without an API key or with RERANK_ENABLED=false: results stay retrieval_only."""
    return shared_model(budgeted=True) if get_settings().rerank_enabled else None


def get_ai_engine_model(model: JsonModel | None = Depends(get_rerank_model)) -> JsonModel | None:
    """The model that names items itself (engine "ai"): the rerank model, its 429 cooldown and its test override."""
    return model


def get_pipeline_config() -> PipelineConfig:
    return PipelineConfig(log_raw_text=get_settings().log_raw_text)


@router.post("/api/recommend")
def recommend_route(request: RecommendRequest, http: Request, session: Session = Depends(get_session),
                    embed_query=Depends(get_query_embedder), rerank_model=Depends(get_rerank_model),
                    ai_model=Depends(get_ai_engine_model), config: PipelineConfig = Depends(get_pipeline_config),
                    user_id: uuid.UUID | None = Depends(optional_user_id), settings: Settings = Depends(get_settings)):
    # The models go through this request's gate (budget.py): the caller's day is charged at the first call that really
    # reaches a model, and past the allowance or the service's budget the pipeline answers as it does when a model
    # fails. `limit` then tells the browser it was a limit, not a fault.
    gate = Gate(allowance_for(http, user_id, session, settings))
    ai_model, rerank_model, embed_query = gate.model(ai_model), gate.model(rerank_model), gate.embedder(embed_query)
    if engine_for(request) == "ai":
        answer = recommend_ai(session, request, ai_model, config, embed_query=embed_query, rerank_model=rerank_model)
    else:
        answer = recommend(session, request, embed_query, config, rerank_model=rerank_model)
        answer["meta"]["engine"] = "catalog"
    if limit := gate.limit():
        answer["meta"]["limit"] = limit
    count(session, f"recommend:{request.category}", address=client_address(http, settings.trust_proxy))  # admin dashboard (stats.py)
    return answer
