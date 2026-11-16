from functools import lru_cache
from typing import Annotated, Literal

import uuid

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, StringConstraints

from sqlalchemy.orm import Session

from ..budget import Gate, allowance_for
from ..config import Settings, get_settings
from ..db import get_session
from ..llm.client import JsonModel
from ..llm.provider import shared_model
from ..parsing.service import ParseService
from ..vocab import get_vocab
from .auth import optional_user_id

router = APIRouter()


class ParseRequest(BaseModel):
    category: Literal["food", "music"]
    text: Annotated[str, StringConstraints(max_length=300)]


@lru_cache
def get_parse_service() -> ParseService:
    return ParseService()


def get_parse_model() -> JsonModel | None:
    """None without an API key or with PARSE_ENABLED=false: the rule result is returned as is."""
    return shared_model(budgeted=True) if get_settings().parse_enabled else None


@router.post("/api/parse")
def parse_route(request: ParseRequest, http: Request, service: ParseService = Depends(get_parse_service), model=Depends(get_parse_model),
                session: Session = Depends(get_session), user_id: uuid.UUID | None = Depends(optional_user_id),
                settings: Settings = Depends(get_settings)):
    # The model goes through this request's gate (budget.py): the caller's day is charged only when the model is really
    # asked (most sentences are settled by the rules or the cache), and past the allowance the rules answer alone. That
    # answer counts as a failure, so it is not kept for the next person who sends the same sentence.
    gated = Gate(allowance_for(http, user_id, session, settings)).model(model)
    answer = service.parse(request.category, request.text, get_vocab(), gated)
    # Deploy compatibility, not a feature: Pages builds from before the price removal reject a parse answer without
    # `maxPrice` and then claim the server is unreachable (DEPLOY.md §0). It is always null and never read; current
    # builds drop it (cleanConditions). Remove once those builds are gone (after phase 2).
    return {**answer, "conditions": {**answer["conditions"], "maxPrice": None}}
