"""Per-client request limit for the endpoints that spend API quota or that anyone can write to (plans-rag.md §9).

In-memory and per process: enough for one small deployment. Behind a reverse proxy set TRUST_PROXY=true
so the client address comes from X-Forwarded-For instead of the proxy's own address.
"""
import logging
import time
from collections import deque

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

log = logging.getLogger(__name__)
LIMITED_PATHS = {"/api/recommend", "/api/parse", "/api/auth/signup", "/api/auth/login", "/api/reports",
                 # every route that tries a password or sends mail
                 "/api/auth/password", "/api/auth/delete", "/api/auth/logout-all", "/api/auth/reset/request", "/api/auth/reset/confirm",
                 "/api/client-errors", "/api/auth/verify", "/api/feedback", "/api/stats"}
# Account store uploads (PUT) get a bucket of their own: the browser saves 1.5s after every change, and a burst of saves
# should neither be stopped by the recommend limit nor use it up.
STORE_PATH = "/api/me/store"
# Routes whose whole request is a few short fields: a larger declared body is refused before it is read.
SMALL_BODIES = {"/api/client-errors": 8192}
MAX_CLIENTS = 10_000


class SlidingWindow:
    def __init__(self, per_minute: int, clock=time.monotonic):
        self.per_minute, self.clock = per_minute, clock
        self.hits: dict[str, deque[float]] = {}

    def check(self, key: str) -> float | None:
        """None if allowed (and counted), else seconds until the next request is allowed."""
        now = self.clock()
        window = self.hits.setdefault(key, deque())
        while window and now - window[0] >= 60:
            window.popleft()
        if len(window) >= self.per_minute:
            return 60 - (now - window[0])
        window.append(now)
        if len(self.hits) > MAX_CLIENTS:  # drop idle clients so memory stays bounded
            for idle in [k for k, w in self.hits.items() if not w or now - w[-1] >= 60]:
                del self.hits[idle]
        return None


def client_address(request: Request, trust_proxy: bool) -> str:
    """The caller's address. Behind a trusted proxy it is the right end of X-Forwarded-For: the left end is whatever the
    client sent (a spoofed header bypassed the limit, review 2026-10-26); the proxy appends the address it saw."""
    forwarded = request.headers.get("x-forwarded-for", "")
    if trust_proxy and forwarded:
        return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, per_minute: int, trust_proxy: bool = False, clock=time.monotonic, store_per_minute: int = 0,
                 store_max_bytes: int = 0, guest_per_minute: int = 0, signer=None):
        super().__init__(app)
        self.window, self.trust_proxy, self.logged_shape = SlidingWindow(per_minute, clock) if per_minute > 0 else None, trust_proxy, False
        self.store_window = SlidingWindow(store_per_minute, clock) if store_per_minute > 0 else None
        self.store_max_bytes = store_max_bytes
        # Guests get a smaller window of their own. `signer` (auth.TokenSigner) tells a signed-in caller by the token's
        # signature alone, with no database read; without it everyone is a guest of the general window.
        self.guest_window = SlidingWindow(guest_per_minute, clock) if 0 < guest_per_minute < per_minute and signer else None
        self.signer = signer

    async def dispatch(self, request: Request, call_next):
        if request.method == "PUT" and request.url.path == STORE_PATH:
            # Refused on the declared length, before the body is read and parsed; the route measures the store itself again.
            declared = request.headers.get("content-length", "")
            if self.store_max_bytes and declared.isdigit() and int(declared) > self.store_max_bytes:
                return JSONResponse({"detail": "저장 데이터가 너무 커요. 오래된 기록을 정리한 뒤 다시 시도해주세요."}, status_code=413)
            if self.store_window and (wait := self.store_window.check(self.client_key(request))) is not None:
                return JSONResponse({"detail": "저장 요청이 너무 많아요. 잠시 후 다시 시도해주세요."}, status_code=429,
                                    headers={"Retry-After": str(max(1, round(wait)))})
        if request.method == "POST" and (limit := SMALL_BODIES.get(request.url.path)):
            declared = request.headers.get("content-length", "")
            if not declared.isdigit() or int(declared) > limit:
                return JSONResponse({"detail": "요청이 너무 커요."}, status_code=413)
        if self.window and request.method == "POST" and request.url.path in LIMITED_PATHS:
            member = self.member(request)
            window, key = (self.window, f"u:{member}") if member else (self.guest_window or self.window, self.client_key(request))
            if (wait := window.check(key)) is not None:
                return JSONResponse({"detail": "요청이 너무 많아요. 잠시 후 다시 시도해주세요."}, status_code=429,
                                    headers={"Retry-After": str(max(1, round(wait)))})
        return await call_next(request)

    def member(self, request: Request) -> str | None:
        """The account id of a validly signed token, if any. Counting per account keeps people behind one shared address
        (a campus, a cafe) from using up each other's minute."""
        if not self.signer:
            return None
        scheme, _, token = request.headers.get("authorization", "").partition(" ")
        return self.signer.verify(token) if scheme.lower() == "bearer" and token else None

    def client_key(self, request: Request) -> str:
        if self.trust_proxy and not self.logged_shape and (forwarded := request.headers.get("x-forwarded-for", "")):
            self.logged_shape = True  # once per process: confirms the proxy adds one address (no addresses logged)
            log.warning("rate limit: X-Forwarded-For carries %d address(es)", len(forwarded.split(",")))
        return client_address(request, self.trust_proxy)
