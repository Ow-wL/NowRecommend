from collections.abc import Callable
from functools import lru_cache

from ..budget import BudgetSpent, take_total
from ..config import get_settings
from .client import CooldownModel, GeminiJsonModel, JsonModel


class BudgetedModel:
    """Asks the daily budget before every call, so the bill has a ceiling whoever is calling."""

    def __init__(self, inner: JsonModel, take: Callable[[], bool]):
        self.inner, self.model, self.take = inner, inner.model, take

    def generate_json(self, system: str, payload: dict, schema: dict) -> dict:
        if not self.take():
            raise BudgetSpent("daily AI budget spent")
        return self.inner.generate_json(system, payload, schema)


@lru_cache
def model_named(name: str, budgeted: bool = False) -> JsonModel | None:
    """One object per model name: the quota is per model and project, so a 429 seen by one caller
    must pause every other caller of the same model too. `budgeted` (the API's routes): every call is first counted
    against the day's budget; the command-line tools (draft, eval) are not, they run by hand on a developer's key.
    The budget sits inside the cooldown, so a paused model spends nothing."""
    settings = get_settings()
    if not settings.gemini_api_key:
        return None
    model: JsonModel = GeminiJsonModel(settings.gemini_api_key, name, timeout_ms=settings.rerank_timeout_ms)
    if budgeted:
        model = BudgetedModel(model, take_total)
    return CooldownModel(model)


def shared_model(budgeted: bool = False) -> JsonModel | None:
    """The configured model (LLM_MODEL), shared by rerank, parsing and drafting."""
    return model_named(get_settings().llm_model, budgeted)
