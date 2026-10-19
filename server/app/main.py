from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .ratelimit import RateLimitMiddleware
from .routes import catalog, health, parse, recommend
from .vocab import get_vocab


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_vocab()  # A broken shared/vocab.json should stop startup, not surface mid-request.
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="지금 추천 API", version="0.1.0", lifespan=lifespan)
    settings = get_settings()
    if settings.rate_limit_per_minute > 0:
        # Added before CORS so CORS stays outermost and 429 answers still carry CORS headers.
        app.add_middleware(RateLimitMiddleware, per_minute=settings.rate_limit_per_minute, trust_proxy=settings.trust_proxy)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    app.include_router(health.router)
    app.include_router(catalog.router)
    app.include_router(recommend.router)
    app.include_router(parse.router)
    return app


app = create_app()
