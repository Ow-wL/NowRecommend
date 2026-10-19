"""Tag vocabulary shared with the frontend (shared/vocab.json).

The LLM may only emit values from this vocabulary, so the file is validated at startup.
"""
import json
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, model_validator

Category = Literal["food", "music"]


class CategoryVocab(BaseModel):
    conditionTags: list[str]
    extraTags: list[str]
    exclusions: list[str]
    excludableIngredients: list[str]
    # Words the rule parsers read as exclusions ("밀가루" → 밀, "고기" → 소고기·돼지고기·닭고기).
    exclusionAliases: dict[str, list[str]] = {}

    @model_validator(mode="after")
    def check_consistency(self) -> "CategoryVocab":
        for name in ("conditionTags", "extraTags", "exclusions", "excludableIngredients"):
            values = getattr(self, name)
            if len(values) != len(set(values)) or any(not v.strip() for v in values):
                raise ValueError(f"{name}: 빈 값 또는 중복")
        tags = {*self.conditionTags, *self.extraTags}
        if unknown := set(self.exclusions) - tags - set(self.excludableIngredients):
            raise ValueError(f"exclusions에 정의되지 않은 값: {sorted(unknown)}")
        if missing := set(self.excludableIngredients) - set(self.exclusions):
            raise ValueError(f"제외 목록에 없는 재료: {sorted(missing)}")
        for word, values in self.exclusionAliases.items():
            if not word.strip() or word in self.exclusions or not values or not set(values) <= set(self.exclusions):
                raise ValueError(f"exclusionAliases: 잘못된 동의어 {word!r}")
        return self

    @property
    def tags(self) -> set[str]:
        return {*self.conditionTags, *self.extraTags}


class Vocab(BaseModel):
    version: int
    food: CategoryVocab
    music: CategoryVocab

    def for_category(self, category: Category) -> CategoryVocab:
        return self.food if category == "food" else self.music


def load_vocab(path: Path) -> Vocab:
    return Vocab.model_validate(json.loads(path.read_text(encoding="utf-8")))


@lru_cache
def get_vocab() -> Vocab:
    from .config import get_settings

    return load_vocab(get_settings().vocab_path)
