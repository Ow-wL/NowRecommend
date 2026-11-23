"""Request bodies have a cap and cannot carry a NUL (bodylimit.py, 2026-11-23), and an IPv6 caller counts per /64."""
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.bodylimit import BodyLimitMiddleware
from app.ratelimit import per_subscriber


def client(default_max=100, per_path=None):
    app = FastAPI()

    @app.post("/echo")
    @app.post("/big")
    async def echo(request: Request):
        return {"bytes": len(await request.body())}

    app.add_middleware(BodyLimitMiddleware, default_max=default_max, per_path=per_path or {"/big": 1000})
    return TestClient(app)


def test_a_body_over_its_cap_is_refused_before_the_route_reads_it():
    c = client()
    assert c.post("/echo", content=b"x" * 100).json() == {"bytes": 100}
    assert c.post("/echo", content=b"x" * 101).status_code == 413
    assert c.post("/big", content=b"x" * 900).status_code == 200  # a path with a larger cap
    assert c.post("/echo", content=b"x" * 101, headers={"content-length": "abc"}).status_code == 413


def test_a_chunked_body_is_counted_as_it_arrives():
    c = client()
    def chunks():
        for _ in range(5):
            yield b"x" * 40
    assert c.post("/echo", content=chunks()).status_code == 413


def test_a_nul_in_json_is_refused_even_split_across_chunks():
    c = client(default_max=10_000)
    assert c.post("/echo", content=b'{"a":"x\u0000"}').status_code == 400
    def split():
        yield b'{"a":"x\u00'
        yield b'00"}'
    assert c.post("/echo", content=split()).status_code == 400
    assert c.post("/echo", content=b'{"a":"ok"}').status_code == 200


def test_ipv6_counts_per_64_and_ipv4_as_is():
    assert per_subscriber("2001:db8:1:2:aaaa::1") == per_subscriber("2001:db8:1:2:bbbb::9") == "2001:db8:1:2::/64"
    assert per_subscriber("203.0.113.7") == "203.0.113.7"
    assert per_subscriber("unknown") == "unknown"


def test_an_email_is_a_bare_mailbox():
    from app.auth import valid_email
    for good in ("lee@example.com", "first.last+tag@mail.co.kr", "o'neil@example.org"):
        assert valid_email(good), good
    for bad in ('"x"<victim@example.com>', "a,victim@example.com", "lee@example", "lee @example.com", "lee@exa mple.com", "lee@-x.com", "<v@x.com>"):
        assert not valid_email(bad), bad


def test_a_refused_field_is_named_but_what_was_sent_is_not_echoed():
    from app.main import create_app
    c = TestClient(create_app())
    answer = c.post("/api/feedback", json={"kind": "idea", "message": "x", "contact": "short-secret-ish"})
    assert answer.status_code == 422 and "short-secret-ish" not in answer.text and answer.json()["detail"][0]["loc"][-1] == "contact"
