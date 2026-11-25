import os

import pytest
from fastapi.testclient import TestClient

from app.db import DatabaseStatus, check_database
from app.main import create_app
from app.routes.health import database_status


def client_with(status: DatabaseStatus) -> TestClient:
    app = create_app()
    app.dependency_overrides[database_status] = lambda: status
    return TestClient(app)


def test_health_ok():
    with client_with(DatabaseStatus(ok=True, pgvector_available="0.8.0", revision="0012")) as client:
        response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"]["pgvector"]["available"] == "0.8.0"
    assert body["vocab"]["food"] > 0 and body["vocab"]["music"] > 0
    assert set(body["llm"]) == {"configured"}  # never echoes the key


def test_health_reports_unreachable_database():
    with client_with(DatabaseStatus(ok=False, error="OperationalError")) as client:
        response = client.get("/api/health")
    assert response.status_code == 503
    assert response.json()["status"] == "degraded"
    assert response.json()["database"]["error"] == "OperationalError"


def test_health_requires_pgvector():
    with client_with(DatabaseStatus(ok=True)) as client:
        response = client.get("/api/health")
    assert response.status_code == 503


def test_health_is_not_ok_on_a_database_that_was_never_migrated():
    """2026-11-17: a database restored empty answers "SELECT 1" and has pgvector, but no tables. The uptime check must see it."""
    with client_with(DatabaseStatus(ok=True, pgvector_available="0.8.0", revision=None)) as client:
        response = client.get("/api/health")
    assert response.status_code == 503 and response.json()["database"]["revision"] is None
    with client_with(DatabaseStatus(ok=True, pgvector_available="0.8.0", revision="0012")) as client:
        assert client.get("/api/health").json()["database"]["revision"] == "0012"


def test_api_docs_are_off_unless_asked_for(monkeypatch):
    """Review 2026-11-26: the deployed API listed every route, the admin ones too, at /openapi.json."""
    from app.config import get_settings
    with client_with(DatabaseStatus(ok=True, pgvector_available="0.8.0", revision="0012")) as client:
        assert [client.get(path).status_code for path in ("/docs", "/redoc", "/openapi.json")] == [404, 404, 404]
    monkeypatch.setenv("API_DOCS", "true")
    get_settings.cache_clear()
    try:
        with client_with(DatabaseStatus(ok=True, pgvector_available="0.8.0", revision="0012")) as client:
            assert client.get("/openapi.json").status_code == 200
    finally:
        monkeypatch.delenv("API_DOCS")
        get_settings.cache_clear()


def test_cors_allows_local_frontend_only():
    with client_with(DatabaseStatus(ok=True, pgvector_available="0.8.0", revision="0012")) as client:
        allowed = client.get("/api/health", headers={"Origin": "http://127.0.0.1:5173"})
        other = client.get("/api/health", headers={"Origin": "https://example.com"})
    assert allowed.headers.get("access-control-allow-origin") == "http://127.0.0.1:5173"
    assert "access-control-allow-origin" not in other.headers


@pytest.mark.db
@pytest.mark.skipif(os.environ.get("NOWREC_DB_TESTS") != "1", reason="set NOWREC_DB_TESTS=1 with docker compose up db")
def test_real_database_has_pgvector():
    status = check_database()
    assert status.ok, status.error
    assert status.pgvector_available
    assert status.revision  # the development database has been migrated
