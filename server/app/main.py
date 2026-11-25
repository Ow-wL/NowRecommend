from contextlib import asynccontextmanager

from fastapi.exceptions import RequestValidationError
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .auth import absent_hash
from .config import get_settings
from .errors import ErrorResponseMiddleware, PasswordBusy
from .legal import get_legal
from .ratelimit import RateLimitMiddleware
from .bodylimit import BodyLimitMiddleware
from .routes import admin, auth, catalog, client_errors, feedback, health, parse, recommend, reports, stats, youtube
from .routes.auth import get_signer
from .vocab import get_vocab


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_vocab()  # A broken shared/vocab.json should stop startup, not surface mid-request.
    get_legal()  # likewise shared/legal.json: sign-up cannot work without it
    absent_hash()  # made once now, so the first login for an unknown address takes no longer than any other
    yield


async def quiet_validation_error(request, exc: RequestValidationError):
    """FastAPI's 422, without the `input` and `ctx` it would echo back: the field and the reason are enough."""
    from fastapi.responses import JSONResponse
    return JSONResponse({"detail": [{k: v for k, v in e.items() if k in ("type", "loc", "msg")} for e in exc.errors()]}, status_code=422)


async def password_busy(request, exc):
    """Too many password checks at once (auth.HASH_WORKERS): try again shortly, instead of every request slowing down."""
    from fastapi.responses import JSONResponse
    return JSONResponse({"detail": "지금 로그인 요청이 많아요. 잠시 후 다시 시도해주세요."}, status_code=503, headers={"Retry-After": "5"})


def create_app() -> FastAPI:
    app = FastAPI(title="지금 추천 API", version="0.1.0", lifespan=lifespan)
    # A refused field is named, but what was sent is not sent back (a short password would be): 2026-11-23 review.
    app.add_exception_handler(RequestValidationError, quiet_validation_error)
    app.add_exception_handler(PasswordBusy, password_busy)
    settings = get_settings()
    # Innermost, so CORS (added last, outermost) still decorates the 500 it produces and browsers read it as a server error.
    app.add_middleware(ErrorResponseMiddleware)
    if settings.rate_limit_per_minute > 0 or settings.store_writes_per_minute > 0 or settings.store_max_bytes > 0:
        # Added before CORS so CORS stays outermost and 429 answers still carry CORS headers.
        # The declared-length check leaves room for the JSON around the store ({"store": …, "baseVersion": n}).
        app.add_middleware(RateLimitMiddleware, per_minute=settings.rate_limit_per_minute, trust_proxy=settings.trust_proxy,
                           store_per_minute=settings.store_writes_per_minute, store_max_bytes=settings.store_max_bytes + 4096,
                           guest_per_minute=settings.rate_limit_guest_per_minute, signer=get_signer())
    # Every request body has a byte cap before anything reads it (bodylimit.py): one instance, 512 MiB.
    app.add_middleware(BodyLimitMiddleware, per_path={"/api/me/store": (settings.store_max_bytes or 1_000_000) + 4096, "/api/client-errors": 8192})
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type", "Authorization"],
    )
    app.include_router(health.router)
    app.include_router(catalog.router)
    app.include_router(recommend.router)
    app.include_router(parse.router)
    app.include_router(auth.router)
    app.include_router(reports.router)
    app.include_router(client_errors.router)
    app.include_router(youtube.router)
    app.include_router(feedback.router)
    app.include_router(stats.router)
    app.include_router(admin.router)

    @app.middleware("http")
    async def admin_not_cached(request, call_next):
        """Nothing an admin reads is kept by a browser or a proxy cache (admin console, 2026-11-26): it names people and places."""
        response = await call_next(request)
        if request.url.path.startswith("/api/admin/"):
            response.headers["Cache-Control"] = "no-store"
        return response
    return app


app = create_app()

