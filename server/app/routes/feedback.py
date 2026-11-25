"""의견 보내기 (2026-11-18): anyone can tell the service something, an admin account reads it.

Not tied to an account and no address of the sender kept: what was said, its kind, which screen it was sent from and the
app's version, and an address to answer to only if the person wrote one (not checked to be theirs). Counted per calling
address (as a keyed hash, budget.py) and for the whole service per day. Removed after a year (retention.py), or by an
admin at any time.
"""
import uuid
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, StringConstraints, field_validator
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from ..auth import normalize_email, valid_email
from ..budget import Allowance, guest_key
from ..config import Settings, get_settings
from ..db import get_session
from ..models import Feedback, User
from ..ratelimit import client_address
from ..stats import count
from .auth import _iso
from .reports import require_admin

router = APIRouter()

Kind = Literal["praise", "problem", "idea", "other"]
PAGE_SIZE = 50


class FeedbackRequest(BaseModel):
    kind: Kind
    message: Annotated[str, StringConstraints(min_length=1, max_length=1000, strip_whitespace=True)]
    contact: Annotated[str, StringConstraints(max_length=254, strip_whitespace=True)] = ""
    # The screen's name only (the part of the address after #/ up to the next /): never a link's token.
    page: Annotated[str, StringConstraints(pattern=r"^[a-z-]{0,24}$")] = ""
    appVersion: Annotated[str, StringConstraints(pattern=r"^[0-9A-Za-z.+-]{0,40}$")] = ""

    @field_validator("contact")
    @classmethod
    def email_or_nothing(cls, value: str) -> str:
        if not value:
            return ""
        value = normalize_email(value)
        if not valid_email(value):
            raise ValueError("답장 받을 이메일 형식이 아니에요")
        return value


def public_feedback(item: Feedback) -> dict:
    return {"id": str(item.id), "createdAt": _iso(item.created_at), "kind": item.kind, "message": item.message,
            "contact": item.contact or None, "page": item.page, "appVersion": item.app_version,
            "status": item.status or "new", "handledAt": _iso(item.handled_at), "note": item.note or ""}


class FeedbackUpdate(BaseModel):
    """Settling feedback in the admin console's inbox (2026-11-26): done or back to new, and a note only admins read."""
    status: Literal["new", "done"] | None = None
    note: Annotated[str, StringConstraints(max_length=300, strip_whitespace=True)] | None = None


@router.post("/api/feedback", status_code=201)
def send_feedback(request: FeedbackRequest, http: Request, session: Session = Depends(get_session), settings: Settings = Depends(get_settings)):
    place = Allowance(session, f"feedback:{guest_key(client_address(http, settings.trust_proxy), settings.auth_secret)}",
                      settings.feedback_daily_per_address, False)
    if not place.take():
        raise HTTPException(429, "오늘은 이 네트워크에서 의견을 더 보낼 수 없어요. 내일 다시 보내주세요.")
    if not Allowance(session, "feedback:total", settings.feedback_daily_total, False).take():
        place.give_back()
        raise HTTPException(429, "오늘은 의견을 더 받을 수 없어요. 내일 다시 보내주세요.")
    item = Feedback(kind=request.kind, message=request.message, contact=request.contact or None, page=request.page, app_version=request.appVersion)
    session.add(item)
    session.commit()
    count(session, "feedback")
    return {"id": str(item.id)}


@router.get("/api/admin/feedback")
def list_feedback(before: datetime | None = None, beforeId: uuid.UUID | None = None, status: Literal["new", "done", "all"] = "all",
                  kind: Kind | Literal["all"] = "all", _: User = Depends(require_admin), session: Session = Depends(get_session)):
    """Newest first, PAGE_SIZE at a time; `before` and `beforeId` are the createdAt and id of the last one already shown
    (both: two sent in the same instant are told apart by the id, so neither is skipped)."""
    query = select(Feedback).order_by(Feedback.created_at.desc(), Feedback.id.desc()).limit(PAGE_SIZE + 1)
    if before is not None:
        query = query.where(or_(Feedback.created_at < before, and_(Feedback.created_at == before, Feedback.id < beforeId)) if beforeId else Feedback.created_at < before)
    if status != "all":
        query = query.where(Feedback.status == status)
    if kind != "all":
        query = query.where(Feedback.kind == kind)
    items = session.scalars(query).all()
    counts = dict(session.execute(select(Feedback.status, func.count()).group_by(Feedback.status)).all())
    return {"feedback": [public_feedback(item) for item in items[:PAGE_SIZE]], "more": len(items) > PAGE_SIZE,
            "counts": {s: counts.get(s, 0) for s in ("new", "done")}}


@router.post("/api/admin/feedback/{feedback_id}")
def update_feedback(feedback_id: uuid.UUID, update: FeedbackUpdate, admin: User = Depends(require_admin), session: Session = Depends(get_session)):
    from .admin import audit
    item = session.get(Feedback, feedback_id)
    if item is None:
        raise HTTPException(404, "의견을 찾지 못했어요.")
    if update.status is not None and update.status != item.status:
        item.status = update.status
        item.handled_at = datetime.now(timezone.utc) if update.status == "done" else None
        audit(session, admin, f"feedback_{update.status}", "feedback", str(item.id))
    if update.note is not None and update.note != item.note:
        item.note = update.note
        audit(session, admin, "feedback_note", "feedback", str(item.id))
    session.commit()
    return public_feedback(item)


@router.delete("/api/admin/feedback/{feedback_id}", status_code=204)
def delete_feedback(feedback_id: uuid.UUID, admin: User = Depends(require_admin), session: Session = Depends(get_session)):
    from .admin import audit
    item = session.get(Feedback, feedback_id)
    if item is not None:
        session.delete(item)
        audit(session, admin, "feedback_delete", "feedback", str(feedback_id), kind=item.kind)
        session.commit()
    return Response(status_code=204)
