"""A cap on every request body (2026-11-23).

The service runs one Cloud Run instance with 512 MiB. FastAPI reads and parses a JSON body before a route's own checks,
so a single request of tens of megabytes could take the instance's memory and every other visitor's requests with it
(security review, 2026-11-23). This middleware refuses a body over its cap before the application reads it: on the
declared Content-Length when there is one, and by counting the bytes as they arrive when there is not (a chunked upload).
It also refuses a JSON body that carries a NUL character (\u0000): PostgreSQL cannot store one in text or JSONB, and
the failure surfaced as a 500 and an alert instead of a plain refusal.
"""
from collections.abc import Awaitable, Callable, Mapping

from fastapi import HTTPException

Scope = dict
Message = dict
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]

DEFAULT_MAX = 256 * 1024  # a recommendation request with a long taste and history is well under this


class _TooLarge(HTTPException):
    """Raised while the body arrives. Before FastAPI reads it, this middleware answers 413; once FastAPI is reading a
    body it reports any error there as its own 400. Either way nothing past the cap is read."""
    def __init__(self):
        super().__init__(413, "요청이 너무 커요.")


class _Nul(HTTPException):
    def __init__(self):
        super().__init__(400, "보낼 수 없는 문자가 들어 있어요.")


NUL = b"\\u0000"  # the six bytes of the JSON escape


class BodyLimitMiddleware:
    def __init__(self, app, default_max: int = DEFAULT_MAX, per_path: Mapping[str, int] | None = None):
        self.app, self.default_max, self.per_path = app, default_max, dict(per_path or {})

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] in ("GET", "HEAD", "OPTIONS"):
            await self.app(scope, receive, send)
            return
        limit = self.per_path.get(scope["path"], self.default_max)
        declared = dict(scope.get("headers") or []).get(b"content-length")
        if declared is not None and (not declared.isdigit() or int(declared) > limit):
            await _refuse(send)
            return
        seen, started, tail = 0, False, b""

        async def counted() -> Message:
            nonlocal seen, tail
            message = await receive()
            if message["type"] == "http.request":
                chunk = message.get("body", b"")
                seen += len(chunk)
                if seen > limit:
                    raise _TooLarge
                if NUL in tail + chunk:  # the tail catches one split across two chunks
                    raise _Nul
                tail = (tail + chunk)[-(len(NUL) - 1):]  # however small the chunks
            return message

        async def watched(message: Message) -> None:
            nonlocal started
            started = started or message["type"] == "http.response.start"
            await send(message)

        try:
            await self.app(scope, counted, watched)
        except _TooLarge:
            if not started:
                await _refuse(send)
        except _Nul:
            if not started:
                await _refuse(send, 400, "보낼 수 없는 문자가 들어 있어요.")


async def _refuse(send: Send, status: int = 413, detail: str = "요청이 너무 커요.") -> None:
    body = ('{"detail":"%s"}' % detail).encode()
    await send({"type": "http.response.start", "status": status,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
    await send({"type": "http.response.body", "body": body})
