from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routes import health
from .vocab import get_vocab


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_vocab()  # A broken shared/vocab.json should stop startup, not surface mid-request.
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="지금 추천 API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=get_settings().cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    app.include_router(health.router)
    return app


app = create_app()
