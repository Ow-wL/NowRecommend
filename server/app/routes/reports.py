"""Error reports (2026-11-03): anyone can flag a card, an admin account reads and settles them.

Only an item id, a kind and a note come from the browser. The item's name is read here, and the admin page finds the picture from
its own media table, so a report cannot make an admin's browser load an address someone else chose.
"""
import uuid
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..ai_items import is_ai_pick
from ..auth import TokenSigner
from ..db import get_session
from ..models import Item, Report, User
from .auth import _iso, _is_uuid, current_user, get_signer

router = APIRouter()

Kind = Literal["wrong_image", "wrong_info", "not_exist", "other"]
Status = Literal["open", "resolved", "dismissed"]
LIST_LIMIT = 200
# Set on an AI pick whose borrowed picture an admin took away: not None, so a later pick of the same name does not link it again.
NO_PARENT = ""


class ReportRequest(BaseModel):
    itemId: Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]{0,39}$")]
    kind: Kind
    note: Annotated[str, StringConstraints(max_length=300, strip_whitespace=True)] = ""


class ReportUpdate(BaseModel):
    status: Status | None = None
    dropImage: bool = Field(False, description="Stop an AI pick borrowing its general dish's picture.")


def require_admin(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(403, "관리자만 볼 수 있어요.")
    return user


def optional_user_id(authorization: Annotated[str | None, Header()] = None, signer: TokenSigner | None = Depends(get_signer),
                     session: Session = Depends(get_session)) -> uuid.UUID | None:
    """Who is reporting, if signed in. A stale or bad token only makes it a guest's report."""
    scheme, _, token = (authorization or "").partition(" ")
    user_id = signer.verify(token) if signer and scheme.lower() == "bearer" and token else None
    if not user_id or not _is_uuid(user_id):
        return None
    known = session.get(User, uuid.UUID(user_id))
    return known.id if known else None


def public_report(report: Report, item: Item | None) -> dict:
    return {
        "id": str(report.id), "createdAt": _iso(report.created_at), "kind": report.kind, "note": report.note, "status": report.status,
        "resolvedAt": _iso(report.resolved_at), "byMember": report.user_id is not None,
        "item": {"id": report.item_id, "category": report.category, "name": report.item_name, "subtitle": report.item_subtitle,
                 **({"parentId": item.parent_id} if item and item.parent_id else {})},
        "canDropImage": bool(item and item.parent_id and is_ai_pick(item.id)),
    }


@router.post("/api/reports", status_code=201)
def create_report(request: ReportRequest, session: Session = Depends(get_session), user_id: uuid.UUID | None = Depends(optional_user_id)):
    item = session.get(Item, request.itemId)
    if item is None:
        raise HTTPException(404, "신고할 항목을 찾지 못했어요.")
    report = Report(item_id=item.id, category=item.category, item_name=item.name, item_subtitle=item.subtitle, kind=request.kind,
                    note=request.note, user_id=user_id)
    session.add(report)
    session.commit()
    return {"id": str(report.id)}


@router.get("/api/admin/reports")
def list_reports(status: Status | Literal["all"] = "open", _: User = Depends(require_admin), session: Session = Depends(get_session)):
    query = select(Report).order_by(Report.created_at.desc()).limit(LIST_LIMIT)
    if status != "all":
        query = query.where(Report.status == status)
    reports = session.scalars(query).all()
    items = {i.id: i for i in session.scalars(select(Item).where(Item.id.in_({r.item_id for r in reports})))} if reports else {}
    counts = dict(session.execute(select(Report.status, func.count()).group_by(Report.status)).all())
    return {"reports": [public_report(r, items.get(r.item_id)) for r in reports],
            "counts": {s: counts.get(s, 0) for s in ("open", "resolved", "dismissed")}}


@router.post("/api/admin/reports/{report_id}")
def update_report(report_id: uuid.UUID, update: ReportUpdate, _: User = Depends(require_admin), session: Session = Depends(get_session)):
    report = session.get(Report, report_id)
    if report is None:
        raise HTTPException(404, "신고를 찾지 못했어요.")
    item = session.get(Item, report.item_id)
    if update.dropImage:
        if not (item and item.parent_id and is_ai_pick(item.id)):
            raise HTTPException(409, "사진을 뺄 수 있는 항목이 아니에요.")
        item.parent_id = NO_PARENT
    if update.status:
        report.status = update.status
        report.resolved_at = None if update.status == "open" else datetime.now(timezone.utc)
    session.commit()
    return public_report(report, item)
