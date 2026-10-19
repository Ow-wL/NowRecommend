from functools import lru_cache

from ..config import get_settings
from .client import CooldownModel, GeminiJsonModel, JsonModel


@lru_cache
def shared_model() -> JsonModel | None:
    """One model object for rerank and parsing: the quota is per model and project, so a 429 seen by
    one must pause the other too."""
    settings = get_settings()
    if not settings.gemini_api_key:
        return None
    return CooldownModel(GeminiJsonModel(settings.gemini_api_key, settings.llm_model, timeout_ms=settings.rerank_timeout_ms))
