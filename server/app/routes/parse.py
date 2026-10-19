from functools import lru_cache
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, StringConstraints

from ..config import get_settings
from ..llm.client import JsonModel
from ..llm.provider import shared_model
from ..parsing.service import ParseService
from ..vocab import get_vocab

router = APIRouter()


class ParseRequest(BaseModel):
    category: Literal["food", "music"]
    text: Annotated[str, StringConstraints(max_length=300)]


@lru_cache
def get_parse_service() -> ParseService:
    return ParseService()


def get_parse_model() -> JsonModel | None:
    """None without an API key or with PARSE_ENABLED=false: the rule result is returned as is."""
    return shared_model() if get_settings().parse_enabled else None


@router.post("/api/parse")
def parse_route(request: ParseRequest, service: ParseService = Depends(get_parse_service), model=Depends(get_parse_model)):
    return service.parse(request.category, request.text, get_vocab(), model)
