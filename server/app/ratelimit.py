"""Per-client request limit for the endpoints that spend API quota (plans-rag.md §9).

In-memory and per process: enough for one small deployment. Behind a reverse proxy set TRUST_PROXY=true
so the client address comes from X-Forwarded-For instead of the proxy's own address.
"""
import time
from collections import deque

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

LIMITED_PATHS = {"/api/recommend", "/api/parse", "/api/lab/music/free"}
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


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, per_minute: int, trust_proxy: bool = False, clock=time.monotonic):
        super().__init__(app)
        self.window, self.trust_proxy = SlidingWindow(per_minute, clock), trust_proxy

    async def dispatch(self, request: Request, call_next):
        if request.method == "POST" and request.url.path in LIMITED_PATHS:
            if (wait := self.window.check(self.client_key(request))) is not None:
                return JSONResponse({"detail": "요청이 너무 많아요. 잠시 후 다시 시도해주세요."}, status_code=429,
                                    headers={"Retry-After": str(max(1, round(wait)))})
        return await call_next(request)

    def client_key(self, request: Request) -> str:
        forwarded = request.headers.get("x-forwarded-for", "")
        if self.trust_proxy and forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"
