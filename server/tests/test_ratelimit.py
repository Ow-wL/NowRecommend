from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from app.main import create_app
from app.ratelimit import RateLimitMiddleware, SlidingWindow


class Clock:
    now = 0.0

    def __call__(self):
        return self.now


def test_window_allows_n_per_minute_then_reports_the_wait():
    clock = Clock()
    window = SlidingWindow(2, clock)
    assert window.check("a") is None and window.check("a") is None
    clock.now = 20
    assert window.check("a") == 40 and window.check("b") is None
    clock.now = 60
    assert window.check("a") is None


def app_with(limit, trust_proxy=False):
    app = FastAPI()
    app.add_middleware(RateLimitMiddleware, per_minute=limit, trust_proxy=trust_proxy)
    app.add_middleware(CORSMiddleware, allow_origins=["http://127.0.0.1:5173"], allow_methods=["GET", "POST"])
    app.post("/api/parse")(lambda: {"ok": True})
    app.get("/api/catalog")(lambda: {"ok": True})
    return TestClient(app)


def test_only_quota_spending_posts_are_limited_and_429_keeps_cors():
    client = app_with(1)
    origin = {"Origin": "http://127.0.0.1:5173"}
    assert client.post("/api/parse", headers=origin).status_code == 200
    refused = client.post("/api/parse", headers=origin)
    assert refused.status_code == 429 and int(refused.headers["retry-after"]) >= 1
    assert refused.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
    assert all(client.get("/api/catalog").status_code == 200 for _ in range(3))


def test_forwarded_for_is_used_only_behind_a_trusted_proxy():
    direct, proxied = app_with(1), app_with(1, trust_proxy=True)
    for client, expected in ((direct, 429), (proxied, 200)):
        client.post("/api/parse", headers={"X-Forwarded-For": "1.1.1.1"})
        assert client.post("/api/parse", headers={"X-Forwarded-For": "2.2.2.2"}).status_code == expected


def test_a_spoofed_forwarded_for_prefix_does_not_reset_the_limit():
    # The proxy appends the address it saw; whatever the client put in front must not pick the bucket.
    client = app_with(1, trust_proxy=True)
    client.post("/api/parse", headers={"X-Forwarded-For": "9.9.9.1, 3.3.3.3"})
    assert client.post("/api/parse", headers={"X-Forwarded-For": "9.9.9.2, 3.3.3.3"}).status_code == 429


def test_store_uploads_have_their_own_bucket_and_a_declared_size_limit():
    app = FastAPI()
    app.add_middleware(RateLimitMiddleware, per_minute=1, store_per_minute=2, store_max_bytes=100)
    app.post("/api/parse")(lambda: {"ok": True})
    app.put("/api/me/store")(lambda: {"ok": True})
    app.get("/api/me/store")(lambda: {"ok": True})
    client = TestClient(app)
    assert client.post("/api/parse").status_code == 200 and client.post("/api/parse").status_code == 429
    # Saves are counted apart from the recommend limit, and reads are never counted.
    assert [client.put("/api/me/store", json={"store": {}}).status_code for _ in range(3)] == [200, 200, 429]
    assert all(client.get("/api/me/store").status_code == 200 for _ in range(5))
    other = TestClient(app, client=("10.0.0.9", 50000))
    assert other.put("/api/me/store", content=b"x" * 101, headers={"Content-Type": "application/json"}).status_code == 413


def test_store_limits_stay_when_the_general_limit_is_off():
    app = FastAPI()
    app.add_middleware(RateLimitMiddleware, per_minute=0, store_per_minute=1, store_max_bytes=100)
    app.post("/api/parse")(lambda: {"ok": True})
    app.put("/api/me/store")(lambda: {"ok": True})
    client = TestClient(app)
    assert all(client.post("/api/parse").status_code == 200 for _ in range(3))
    assert [client.put("/api/me/store", json={}).status_code for _ in range(2)] == [200, 429]


def test_app_installs_the_limit_by_default():
    assert any(m.cls is RateLimitMiddleware for m in create_app().user_middleware)
