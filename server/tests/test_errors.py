from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from app.errors import ErrorResponseMiddleware
from app.main import create_app


def failing_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(ErrorResponseMiddleware)
    app.add_middleware(CORSMiddleware, allow_origins=["http://127.0.0.1:5180"], allow_methods=["GET"])

    @app.get("/boom")
    def boom():
        raise RuntimeError("database away")

    @app.get("/fine")
    def fine():
        return {"ok": True}

    return app


def test_an_unhandled_error_is_a_json_500_with_cors_headers():
    client = TestClient(failing_app(), raise_server_exceptions=False)
    response = client.get("/boom", headers={"Origin": "http://127.0.0.1:5180"})
    assert response.status_code == 500
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5180"
    assert "잠시 후" in response.json()["detail"]
    assert "database away" not in response.text  # the cause stays in the log, not in the answer


def test_a_normal_answer_is_untouched():
    client = TestClient(failing_app())
    response = client.get("/fine", headers={"Origin": "http://127.0.0.1:5180"})
    assert response.status_code == 200 and response.json() == {"ok": True}
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5180"


def test_the_real_app_carries_the_middleware_inside_cors():
    app = create_app()
    names = [m.cls.__name__ for m in app.user_middleware]
    # user_middleware lists the outermost first: CORS must wrap the error layer.
    assert names.index("CORSMiddleware") < names.index("ErrorResponseMiddleware")
