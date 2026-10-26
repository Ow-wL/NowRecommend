"""POST /api/parse logic: rules first, the LLM only for words the rules did not explain."""
import logging
from collections import OrderedDict

from ..llm.client import JsonModel
from ..vocab import Vocab
from .ai import ai_parse, merge
from .coverage import uncovered_words
from .rules import parse_rules

log = logging.getLogger(__name__)


class ParseService:
    """Caches answers per (category, sentence) so going back and forth costs no extra model calls.
    Failures are not cached, so the next confirmation can try the model again."""

    def __init__(self, maxsize: int = 512):
        self.maxsize = maxsize
        self._cache: OrderedDict[tuple[str, str], dict] = OrderedDict()

    def parse(self, category: str, text: str, vocab: Vocab, model: JsonModel | None) -> dict:
        key = (category, " ".join(text.split()))
        if key in self._cache:
            self._cache.move_to_end(key)
            return self._cache[key]
        rules = parse_rules(text, category)
        conditions, uncovered = rules.conditions(), uncovered_words(text, rules.spans)
        # Phrases the app does not support (price, delivery, nearby, unknown ingredients) are reported, never applied.
        unsupported = rules.unsupported
        if not uncovered:
            return self._store(key, {"conditions": conditions, "unparsed": [], "unsupported": unsupported, "source": "rule", "ai": "not_needed"})
        if model is None:
            return self._store(key, {"conditions": conditions, "unparsed": uncovered, "unsupported": unsupported, "source": "rule", "ai": "unavailable"})
        try:
            ai = ai_parse(model, category, text, vocab.for_category(category), conditions, uncovered)
        except Exception as exc:  # Quota, overload, timeout, bad JSON: the rule result still stands.
            log.warning("parse model failed: %s", exc)
            return {"conditions": conditions, "unparsed": uncovered, "unsupported": unsupported, "source": "rule", "ai": "failed"}
        return self._store(key, {"conditions": merge(conditions, ai, text, category, rules.not_wanted), "unparsed": ai.unparsed, "unsupported": unsupported, "source": "rule+ai", "ai": "used"})

    def _store(self, key: tuple[str, str], value: dict) -> dict:
        self._cache[key] = value
        if len(self._cache) > self.maxsize:
            self._cache.popitem(last=False)
        return value
