from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, model_validator

from .vocab import get_vocab

ItemId = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]{0,39}$")]
IdList = Annotated[list[ItemId], Field(max_length=200)]
Tag = Annotated[str, StringConstraints(min_length=1, max_length=20)]


class Conditions(BaseModel):
    tags: Annotated[list[Tag], Field(max_length=30)] = []
    excluded: Annotated[list[Tag], Field(max_length=30)] = []
    maxPrice: Annotated[int, Field(ge=100, le=1_000_000)] | None = None


class Profile(BaseModel):
    selected: IdList = []
    tags: Annotated[list[Tag], Field(max_length=30)] = []
    disliked: IdList = []


class RecommendRequest(BaseModel):
    category: Literal["food", "music"]
    raw: Annotated[str, StringConstraints(max_length=300)] = ""
    conditions: Conditions = Conditions()
    profile: Profile = Profile()
    excludedIds: IdList = []
    seenIds: IdList = []
    pinnedIds: Annotated[list[ItemId], Field(max_length=5)] = []
    candidateIds: IdList | None = None  # favorites scope; None means the whole catalog
    count: Annotated[int, Field(ge=1, le=5)] | None = None  # default: food 3, music 5
    tau: Annotated[float, Field(ge=0, le=1)] | None = None  # exploration temperature; 0 = deterministic

    @model_validator(mode="after")
    def known_vocabulary(self) -> "RecommendRequest":
        # Conditions come from the shared vocabulary; anything else is a client bug, not a hint to guess.
        vocab = get_vocab().for_category(self.category)
        unknown = (set(self.conditions.tags) | set(self.profile.tags)) - vocab.tags
        unknown |= set(self.conditions.excluded) - set(vocab.exclusions)
        if unknown:
            raise ValueError(f"알 수 없는 조건: {sorted(unknown)}")
        return self

    @property
    def result_count(self) -> int:
        return self.count or (3 if self.category == "food" else 5)
