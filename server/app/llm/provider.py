from functools import lru_cache

from ..config import get_settings
from .client import CooldownModel, GeminiJsonModel, JsonModel


@lru_cache
def model_named(name: str) -> JsonModel | None:
    """One object per model name: the quota is per model and project, so a 429 seen by one caller
    must pause every other caller of the same model too."""
    settings = get_settings()
    if not settings.gemini_api_key:
        return None
    return CooldownModel(GeminiJsonModel(settings.gemini_api_key, name, timeout_ms=settings.rerank_timeout_ms))


def shared_model() -> JsonModel | None:
    """The configured model (LLM_MODEL), shared by rerank, parsing and drafting."""
    return model_named(get_settings().llm_model)
