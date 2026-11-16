"""Errors from people's browsers, written to the log (2026-11-17).

A screen that fails to draw in production is otherwise invisible: no request fails, nothing reaches the server. The
browser sends the message, the place in the code, which screen and which build (src/errors.ts); this route only logs it,
at warning level, so the same log and the same alerting that watch the API see it. Nothing is stored in the database.
The text is the browser's, so it is cut to size and flattened to one line before it is logged.
"""
import logging
from typing import Annotated, Literal

from fastapi import APIRouter, Response
from pydantic import BaseModel, StringConstraints

log = logging.getLogger("app.client_errors")
router = APIRouter()


class ClientError(BaseModel):
    kind: Literal["render", "error", "promise"]
    message: Annotated[str, StringConstraints(min_length=1, max_length=300)]
    stack: Annotated[str, StringConstraints(max_length=2000)] = ""
    page: Annotated[str, StringConstraints(pattern=r"^[a-z]{1,20}$")] = "home"
    release: Annotated[str, StringConstraints(pattern=r"^[0-9A-Za-z._-]{1,40}$")] = "dev"


def one_line(value: str) -> str:
    """No line breaks or control characters: one report is one log line, and cannot fake another."""
    return " | ".join(part.strip() for part in "".join(c if c.isprintable() or c == "\n" else " " for c in value).split("\n") if part.strip())


@router.post("/api/client-errors", status_code=204)
def client_error(report: ClientError):
    log.warning("client error kind=%s page=%s release=%s message=%s stack=%s", report.kind, report.page, report.release,
                one_line(report.message), one_line(report.stack))
    return Response(status_code=204)
