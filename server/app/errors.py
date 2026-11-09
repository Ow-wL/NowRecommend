"""A 500 the browser can read.

Starlette's own 500 comes from the outermost layer, outside CORSMiddleware, so a browser on another origin sees a CORS block
instead of a server error and the front end cannot tell the two apart. This middleware sits inside CORS: it turns an
unhandled exception into a JSON 500 that CORS then decorates. The traceback still goes to the log.
"""
from __future__ import annotations

import logging

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger("app.errors")
MESSAGE = "서버 오류가 났어요. 잠시 후 다시 시도해 주세요."


class ErrorResponseMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = False

        async def send_tracking(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, send_tracking)
        except Exception:  # noqa: BLE001 - every unhandled error becomes a readable 500
            logger.exception("unhandled error on %s %s", scope.get("method"), scope.get("path"))
            if started:  # headers are out already; nothing left to say but to drop the connection
                raise
            await JSONResponse({"detail": MESSAGE}, status_code=500)(scope, receive, send)
