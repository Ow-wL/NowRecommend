from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from .vocab import get_vocab

ItemId = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]{0,39}$")]
IdList = Annotated[list[ItemId], Field(max_length=200)]
Tag = Annotated[str, StringConstraints(min_length=1, max_length=20)]


class Conditions(BaseModel):
    """No budget: price was removed on 2026-10-27. A `maxPrice` from an older client is ignored (extra fields are dropped)."""
    tags: Annotated[list[Tag], Field(max_length=30)] = []
    excluded: Annotated[list[Tag], Field(max_length=30)] = []


class YearRange(BaseModel):
    """Release years a song must fall in (music only). Either end may be open."""
    model_config = ConfigDict(populate_by_name=True)
    start: int | None = Field(None, ge=1900, le=2100, alias="from")
    end: int | None = Field(None, ge=1900, le=2100, alias="to")

    @model_validator(mode="after")
    def in_order(self) -> "YearRange":
        if self.start is not None and self.end is not None and self.start > self.end:
            raise ValueError("시작 연도가 끝 연도보다 늦어요")
        return self


Note = Annotated[str, StringConstraints(min_length=1, max_length=120)]


class Profile(BaseModel):
    selected: IdList = []
    tags: Annotated[list[Tag], Field(max_length=30)] = []
    disliked: IdList = []
    # Free words for the AI: "치킨: 바삭해서", or something typed in that the catalog does not have.
    notes: Annotated[list[Note], Field(max_length=40)] = []
    customNames: Annotated[list[Note], Field(max_length=30)] = []


class RecommendRequest(BaseModel):
    category: Literal["food", "music"]
    raw: Annotated[str, StringConstraints(max_length=300)] = ""
    conditions: Conditions = Conditions()
    years: YearRange | None = None
    profile: Profile = Profile()
    excludedIds: IdList = []
    seenIds: IdList = []
    pinnedIds: Annotated[list[ItemId], Field(max_length=5)] = []
    candidateIds: IdList | None = None  # favorites scope; None means the whole catalog
    count: Annotated[int, Field(ge=1, le=5)] | None = None  # default: food 3, music 5
    tau: Annotated[float, Field(ge=0, le=1)] | None = None  # exploration temperature; 0 = deterministic
    # "ai": the model names items itself (app/ai_items.py); "catalog": retrieval + rerank over reviewed items.
    # None: the server default (MUSIC_ENGINE for music, catalog for food; favourites scope is always catalog).
    engine: Literal["catalog", "ai"] | None = None

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
