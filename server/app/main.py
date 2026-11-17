from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .errors import ErrorResponseMiddleware
from .legal import get_legal
from .ratelimit import RateLimitMiddleware
from .routes import auth, catalog, client_errors, feedback, health, lab, parse, recommend, reports, youtube
from .routes.auth import get_signer
from .vocab import get_vocab


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_vocab()  # A broken shared/vocab.json should stop startup, not surface mid-request.
    get_legal()  # likewise shared/legal.json: sign-up cannot work without it
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="지금 추천 API", version="0.1.0", lifespan=lifespan)
    settings = get_settings()
    # Innermost, so CORS (added last, outermost) still decorates the 500 it produces and browsers read it as a server error.
    app.add_middleware(ErrorResponseMiddleware)
    if settings.rate_limit_per_minute > 0 or settings.store_writes_per_minute > 0 or settings.store_max_bytes > 0:
        # Added before CORS so CORS stays outermost and 429 answers still carry CORS headers.
        # The declared-length check leaves room for the JSON around the store ({"store": …, "baseVersion": n}).
        app.add_middleware(RateLimitMiddleware, per_minute=settings.rate_limit_per_minute, trust_proxy=settings.trust_proxy,
                           store_per_minute=settings.store_writes_per_minute, store_max_bytes=settings.store_max_bytes + 4096,
                           guest_per_minute=settings.rate_limit_guest_per_minute, signer=get_signer())
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
    app.include_router(lab.router)
    app.include_router(auth.router)
    app.include_router(reports.router)
    app.include_router(client_errors.router)
    app.include_router(youtube.router)
    app.include_router(feedback.router)
    return app


app = create_app()
