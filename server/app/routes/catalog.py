from typing import Literal

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..catalog import catalog_version, public_item, reviewed_items
from ..db import get_session

router = APIRouter()


@router.get("/api/catalog")
def catalog(category: Literal["food", "music"] | None = None, session: Session = Depends(get_session)):
    """Reviewed items only. The version covers the whole catalog so food and music requests agree."""
    everything = [public_item(row) for row in reviewed_items(session)]
    items = [i for i in everything if category is None or i["category"] == category]
    return {"catalogVersion": catalog_version(everything), "items": items}
