from collections.abc import Callable
from functools import lru_cache

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_session
from ..embeddings import GeminiEmbedder, QueryEmbedder
from ..llm.client import JsonModel
from ..llm.provider import shared_model
from ..recommend import PipelineConfig, recommend
from ..schemas import RecommendRequest

router = APIRouter()


@lru_cache
def get_query_embedder() -> Callable[[str], list[float]] | None:
    """None without an API key: ranking then uses taste and condition tags only."""
    settings = get_settings()
    if not settings.gemini_api_key:
        return None
    # One attempt with a short timeout: a slow embedding should degrade the ranking, not stall the request.
    return QueryEmbedder(GeminiEmbedder(settings.gemini_api_key, settings.embedding_model, settings.embedding_dim,
                                        attempts=1, timeout_ms=5000))


def get_rerank_model() -> JsonModel | None:
    """None without an API key or with RERANK_ENABLED=false: results stay retrieval_only."""
    return shared_model() if get_settings().rerank_enabled else None


def get_pipeline_config() -> PipelineConfig:
    return PipelineConfig(log_raw_text=get_settings().log_raw_text)


@router.post("/api/recommend")
def recommend_route(request: RecommendRequest, session: Session = Depends(get_session),
                    embed_query=Depends(get_query_embedder), rerank_model=Depends(get_rerank_model),
                    config: PipelineConfig = Depends(get_pipeline_config)):
    return recommend(session, request, embed_query, config, rerank_model=rerank_model)
