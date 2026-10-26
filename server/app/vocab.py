"""Tag vocabulary shared with the frontend (shared/vocab.json).

The LLM may only emit values from this vocabulary, so the file is validated at startup.
"""
import json
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, model_validator

Category = Literal["food", "music"]


class ExclusionGroup(BaseModel):
    covers: list[str]  # the recorded ingredients the group can actually filter
    uncovered: str     # what it means but the data cannot check, for the UI note


class CategoryVocab(BaseModel):
    conditionTags: list[str]
    extraTags: list[str]
    exclusions: list[str]
    excludableIngredients: list[str]
    # Words the rule parsers read as exclusions ("밀가루" → 밀, "고기" → 소고기·돼지고기·닭고기).
    exclusionAliases: dict[str, list[str]] = {}
    # Broad exclusions the ingredient data covers only in part ("해산물" → 생선); never narrowed to `covers` in the UI.
    exclusionGroups: dict[str, ExclusionGroup] = {}
    # Diet statements that name whole groups anywhere in the sentence ("비건이라서"); applied by the rules.
    dietExclusions: dict[str, list[str]] = {}
    # Ingredients people ask to avoid that the catalog does not record ("새우"): reported as unsupported, never applied.
    unsupportedExclusions: list[str] = []

    @model_validator(mode="after")
    def check_consistency(self) -> "CategoryVocab":
        for name in ("conditionTags", "extraTags", "exclusions", "excludableIngredients"):
            values = getattr(self, name)
            if len(values) != len(set(values)) or any(not v.strip() for v in values):
                raise ValueError(f"{name}: 빈 값 또는 중복")
        tags = {*self.conditionTags, *self.extraTags}
        if unknown := set(self.exclusions) - tags - set(self.excludableIngredients) - set(self.exclusionGroups):
            raise ValueError(f"exclusions에 정의되지 않은 값: {sorted(unknown)}")
        if missing := set(self.excludableIngredients) - set(self.exclusions):
            raise ValueError(f"제외 목록에 없는 재료: {sorted(missing)}")
        for word, values in self.exclusionAliases.items():
            if not word.strip() or word in self.exclusions or not values or not set(values) <= set(self.exclusions):
                raise ValueError(f"exclusionAliases: 잘못된 동의어 {word!r}")
        for name, group in self.exclusionGroups.items():
            if name not in self.exclusions or not group.covers or not set(group.covers) <= set(self.excludableIngredients):
                raise ValueError(f"exclusionGroups: 잘못된 묶음 {name!r}")
        for word, values in self.dietExclusions.items():
            if not word.strip() or not values or not set(values) <= set(self.exclusions):
                raise ValueError(f"dietExclusions: 잘못된 식단 {word!r}")
        if clash := set(self.unsupportedExclusions) & (set(self.exclusions) | set(self.exclusionAliases)):
            raise ValueError(f"unsupportedExclusions가 지원 제외와 겹침: {sorted(clash)}")
        return self

    def blocked(self, excluded: list[str]) -> list[str]:
        """The values an exclusion really blocks: a group blocks the ingredients it covers (blockedValues in src/domain.ts)."""
        return list(dict.fromkeys(v for e in excluded for v in (e, *(self.exclusionGroups[e].covers if e in self.exclusionGroups else ()))))

    @property
    def tags(self) -> set[str]:
        return {*self.conditionTags, *self.extraTags}


class Vocab(BaseModel):
    version: int
    # Words before "빼고/말고/없는…" that are not something to leave out ("건", "부담", "점심"); see unknown_exclusions.
    exclusionStopWords: list[str] = []
    # "건", "거", "음식": the head of a negated phrase ("고소한 건 빼줘"); short ingredient words that are still nouns.
    exclusionHeadNouns: list[str] = []
    exclusionShortWords: dict[str, list[str]] = {}
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
