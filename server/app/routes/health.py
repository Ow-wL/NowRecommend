from fastapi import APIRouter, Depends, Response

from ..config import Settings, get_settings
from ..db import DatabaseStatus, check_database
from ..vocab import get_vocab

router = APIRouter()


def database_status() -> DatabaseStatus:
    return check_database()


@router.get("/api/health")
def health(response: Response, db: DatabaseStatus = Depends(database_status), settings: Settings = Depends(get_settings)):
    vocab = get_vocab()
    ready = db.ok and db.pgvector_available is not None
    if not ready:
        response.status_code = 503
    return {
        "status": "ok" if ready else "degraded",
        "database": {
            "ok": db.ok,
            "error": db.error,
            "pgvector": {"available": db.pgvector_available, "installed": db.pgvector_installed},
        },
        "vocab": {"version": vocab.version, "food": len(vocab.food.tags), "music": len(vocab.music.tags)},
        "llm": {"configured": bool(settings.gemini_api_key)},
    }
