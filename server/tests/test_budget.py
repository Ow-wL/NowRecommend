"""Daily limits (app/budget.py): the counters on SQLite, the model wrapper, and the routes on PostgreSQL."""
from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import budget
from app.auth import TokenSigner
from app.catalog import load_seed, seed_items
from app.config import Settings, get_settings
from app.db import get_session
from app.llm.client import CooldownModel
from app.budget import AllowanceSpent, BudgetedEmbedder, BudgetSpent, Gate
from app.llm.provider import BudgetedModel
from app.main import create_app
from app.models import Feedback, StatsDaily, UsageDaily, User
from app.parsing.service import ParseService
from app.ratelimit import RateLimitMiddleware
from app.routes.auth import get_signer
from app.routes.parse import get_parse_model, get_parse_service
from app.routes.recommend import get_ai_engine_model, get_query_embedder, get_rerank_model
from app.vocab import get_vocab
from tests.conftest import FakeEmbedder, needs_db

DAY = date(2026, 11, 17)
SIGNER = TokenSigner("test-secret", ttl_seconds=3600)


@pytest.fixture
def counters():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    UsageDaily.__table__.create(engine)
    Feedback.__table__.create(engine)
    StatsDaily.__table__.create(engine)  # the dashboard counts (stats.py)
    User.__table__.create(engine)
    with sessionmaker(engine, expire_on_commit=False)() as session:
        yield session


def test_take_counts_up_to_the_limit_and_each_day_and_bucket_alone(counters):
    assert [budget.take(counters, "a", 2, DAY) for _ in range(4)] == [1, 2, None, None]
    assert budget.used(counters, "a", DAY) == 2  # a refused take adds nothing
    assert budget.take(counters, "b", 2, DAY) == 1
    assert budget.take(counters, "a", 2, DAY + timedelta(days=1)) == 1
    # No limit: nothing is counted or stored.
    assert budget.take(counters, "free", 0, DAY) == 0 and budget.used(counters, "free", DAY) == 0


def test_old_days_are_forgotten_after_a_week(counters):
    """The privacy policy says seven days: the counters of today and the six days before stay, older ones go. Any counter's
    first use of a day does the clearing, so it does not wait for one particular kind of request."""
    for back in (1, 6, 7, 8, 30):
        counters.add(UsageDaily(day=DAY - timedelta(days=back), bucket="a", count=3))
    counters.commit()
    assert budget.take(counters, "ai:g:someone", 5, DAY) == 1  # the first use of this counter today
    assert sorted(counters.scalars(select(UsageDaily.day).where(UsageDaily.bucket == "a"))) == [DAY - timedelta(days=6), DAY - timedelta(days=1)]
    counters.add(UsageDaily(day=DAY - timedelta(days=9), bucket="a", count=1))
    counters.commit()
    assert budget.take(counters, "ai:g:someone", 5, DAY) == 2  # not the first: nothing is scanned
    assert counters.scalar(select(UsageDaily.count).where(UsageDaily.day == DAY - timedelta(days=9))) == 1


def test_a_guest_is_kept_as_a_keyed_hash_not_an_address():
    key = budget.guest_key("203.0.113.7", "secret")
    assert "203.0.113.7" not in key and len(key) == 24
    assert key == budget.guest_key("203.0.113.7", "secret") != budget.guest_key("203.0.113.8", "secret")
    assert key != budget.guest_key("203.0.113.7", "other-secret")


class Recording:
    model = "fake-llm"

    def __init__(self, answer=None):
        self.answer, self.calls = answer or {"ok": True}, 0

    def generate_json(self, system, payload, schema):
        self.calls += 1
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


def test_a_spent_budget_stops_the_call_before_the_model_is_asked():
    inner, allowed = Recording(), iter([True, False, False])
    model = CooldownModel(BudgetedModel(inner, lambda: next(allowed)))
    assert model.generate_json("s", {}, {}) == {"ok": True} and model.model == "fake-llm"
    for _ in range(2):  # not a quota answer from the provider, so no cooldown: the next day's first call goes through
        with pytest.raises(BudgetSpent):
            model.generate_json("s", {}, {})
    assert inner.calls == 1


def test_the_service_total_fails_closed_when_the_database_cannot_answer(monkeypatch, counters):
    monkeypatch.setattr(budget, "get_settings", lambda: Settings(ai_daily_limit=2))
    monkeypatch.setattr(budget, "get_sessionmaker", lambda: (lambda: _Managed(counters)))
    assert [budget.take_total() for _ in range(3)] == [True, True, False]

    def broken():
        raise RuntimeError("database is down")

    monkeypatch.setattr(budget, "get_sessionmaker", lambda: broken)
    assert budget.take_total() is False  # an unknown bill is not run up
    monkeypatch.setattr(budget, "get_settings", lambda: Settings(ai_daily_limit=0))
    assert budget.take_total() is True   # off: the database is not even asked


class _Managed:
    def __init__(self, session):
        self.session = session

    def __enter__(self):
        return self.session

    def __exit__(self, *exc):
        return False


def test_guests_get_a_smaller_minute_and_members_are_counted_per_account():
    app = FastAPI()
    app.add_middleware(RateLimitMiddleware, per_minute=3, guest_per_minute=1, signer=SIGNER)
    app.post("/api/recommend")(lambda: {"ok": True})
    client = TestClient(app)
    assert [client.post("/api/recommend").status_code for _ in range(2)] == [200, 429]
    one, two = ({"Authorization": f"Bearer {SIGNER.issue(name)}"} for name in ("user-1", "user-2"))
    # Same address as the guest above, but each account has its own, larger minute.
    assert [client.post("/api/recommend", headers=one).status_code for _ in range(4)] == [200, 200, 200, 429]
    assert client.post("/api/recommend", headers=two).status_code == 200
    # A token that does not verify is a guest's request.
    assert client.post("/api/recommend", headers={"Authorization": "Bearer forged.token"}).status_code == 429


def test_signups_from_one_address_stop_for_the_day(counters):
    app = create_app()
    app.dependency_overrides[get_session] = lambda: counters
    app.dependency_overrides[get_signer] = lambda: SIGNER
    app.dependency_overrides[get_settings] = lambda: Settings(signup_daily_per_address=2)
    with TestClient(app) as client:
        # What is turned away before an account is made uses nothing up: a mistyped form, an address already registered.
        assert client.post("/api/auth/signup", json={"email": "not-an-address", "password": "password1", "name": "이름"}).status_code == 422
        assert client.post("/api/auth/signup", json={"email": "first@example.com", "password": "password1", "name": "이름"}).status_code == 201
        for _ in range(3):
            assert client.post("/api/auth/signup", json={"email": "first@example.com", "password": "password1", "name": "이름"}).status_code == 409
        codes = [client.post("/api/auth/signup", json={"email": f"p{n}@example.com", "password": "password1", "name": "이름"}).status_code for n in range(3)]
        assert codes == [201, 429, 429]  # one of today's two went to first@example.com above
        assert budget.used(counters, next(iter(counters.scalars(select(UsageDaily.bucket))))) == 2  # neither the repeats nor the refusals were counted
        assert client.post("/api/auth/login", json={"email": "p0@example.com", "password": "password1"}).status_code == 200  # signing in is not sign-up


def test_a_sign_up_that_loses_the_race_for_an_address_is_told_so_and_uses_nothing_up(counters, monkeypatch):
    """Two forms with one address arriving together both pass the "is it registered" look; the database lets one in. The
    other reads like any repeat (409), and the day's count goes back to what it was."""
    from app.routes import auth as routes

    app = create_app()
    app.dependency_overrides[get_session] = lambda: counters
    app.dependency_overrides[get_signer] = lambda: SIGNER
    app.dependency_overrides[get_settings] = lambda: Settings(signup_daily_per_address=2)
    real_hash = routes.hash_password

    def someone_else_first(password):
        """Runs between the look and the commit: the same address is registered on another connection's behalf."""
        with sessionmaker(counters.get_bind(), expire_on_commit=False)() as other:
            other.add(User(email="race@example.com", name="먼저", password_hash=real_hash("password2")))
            other.commit()
        return real_hash(password)

    with TestClient(app) as client:
        monkeypatch.setattr(routes, "hash_password", someone_else_first)
        lost = client.post("/api/auth/signup", json={"email": "race@example.com", "password": "password1", "name": "나중"})
        monkeypatch.setattr(routes, "hash_password", real_hash)
        assert lost.status_code == 409 and "이미 가입된" in lost.json()["detail"]
        assert counters.scalar(select(User.name).where(User.email == "race@example.com")) == "먼저"  # the first one's account, untouched
        assert budget.used(counters, counters.scalar(select(UsageDaily.bucket))) == 0
        # Both of today's two are still there for this address.
        codes = [client.post("/api/auth/signup", json={"email": f"q{n}@example.com", "password": "password1", "name": "이름"}).status_code for n in range(3)]
        assert codes == [201, 201, 429]
        assert client.post("/api/auth/login", json={"email": "race@example.com", "password": "password2"}).status_code == 200


def test_giving_back_never_goes_below_zero_and_does_nothing_without_a_limit(counters):
    assert budget.take(counters, "a", 2, DAY) == 1
    budget.give_back(counters, "a", 2, DAY)
    budget.give_back(counters, "a", 2, DAY)
    assert budget.used(counters, "a", DAY) == 0 and [budget.take(counters, "a", 2, DAY) for _ in range(3)] == [1, 2, None]
    budget.give_back(counters, "a", 0, DAY)  # no limit: nothing was counted, nothing to undo
    assert budget.used(counters, "a", DAY) == 2


# ---- routes, on the real database ----

class Picks(Recording):
    def __init__(self):
        super().__init__({"picks": [{"name": f"곡 {n}", "detail": f"가수 {n}", "tasteReason": "취향 이유", "contextReason": "상황 이유", "confidence": "high", "tags": ["차분함"]}
                                    for n in range(8)]})


@pytest.fixture
def api(db_session):
    seed_items(db_session, get_vocab(), load_seed())
    db_session.execute(text("TRUNCATE usage_daily, users CASCADE"))
    db_session.commit()
    model, fake = Picks(), FakeEmbedder()
    app = create_app()
    app.dependency_overrides[get_session] = lambda: db_session
    app.dependency_overrides[get_signer] = lambda: SIGNER
    app.dependency_overrides[get_rerank_model] = lambda: None
    app.dependency_overrides[get_ai_engine_model] = lambda: model
    app.dependency_overrides[get_query_embedder] = lambda: (lambda words: fake.embed([words])[0])
    app.dependency_overrides[get_settings] = lambda: Settings(ai_daily_per_guest=2, ai_daily_per_member=3, signup_daily_per_address=0)
    with TestClient(app) as client:
        yield client, model, app


MUSIC = {"category": "music", "raw": "밤 산책", "conditions": {"tags": ["차분함"], "excluded": []}}


@needs_db
def test_past_the_daily_allowance_the_catalog_answers_and_the_answer_says_why(api):
    client, model, _ = api
    first = [client.post("/api/recommend", json=MUSIC).json()["meta"] for _ in range(2)]
    assert [m["engine"] for m in first] == ["ai", "ai"] and all("limit" not in m for m in first)
    spent = client.post("/api/recommend", json=MUSIC)
    assert spent.status_code == 200 and spent.json()["results"]  # still an answer, from the reviewed catalog
    assert spent.json()["meta"]["engine"] == "catalog" and spent.json()["meta"]["limit"] == "guest"
    assert model.calls == 2  # the model was not asked a third time
    assert "query_embedding:AllowanceSpent" in str(spent.json()["meta"]) or spent.json()["meta"].get("contextSimilarity") is False  # nor was the paid embedding

    # An account has its own, larger day, whatever the guests at the same address used.
    token = client.post("/api/auth/signup", json={"email": "lee@example.com", "password": "password1", "name": "주형"}).json()["token"]
    auth = {"Authorization": f"Bearer {token}"}
    metas = [client.post("/api/recommend", json=MUSIC, headers=auth).json()["meta"] for _ in range(4)]
    assert [m["engine"] for m in metas] == ["ai", "ai", "ai", "catalog"] and metas[3]["limit"] == "member"


@needs_db
def test_a_spent_service_budget_reads_as_a_limit_not_as_a_broken_model(api):
    client, _, app = api
    app.dependency_overrides[get_ai_engine_model] = lambda: BudgetedModel(Picks(), lambda: False)
    meta = client.post("/api/recommend", json=MUSIC).json()["meta"]
    assert meta["engine"] == "catalog" and meta["ai"] == "failed" and meta["limit"] == "service"


@needs_db
def test_parse_counts_only_sentences_the_model_read(api, db_session):
    client, _, app = api
    reader = Recording({"tags": [], "excluded": [], "unparsed": []})
    service = ParseService()
    app.dependency_overrides[get_parse_model] = lambda: reader
    app.dependency_overrides[get_parse_service] = lambda: service
    bucket = db_session.scalars(select(UsageDaily.bucket)).all()
    assert bucket == []
    # Settled by the rules: the model is not asked and nothing is counted.
    assert client.post("/api/parse", json={"category": "music", "text": "차분한 노래"}).json()["ai"] == "not_needed"
    assert reader.calls == 0 and db_session.scalars(select(UsageDaily.count).where(UsageDaily.bucket != "sweep:day")).all() == []
    # Words the rules do not know go to the model, twice, and then the allowance (2) is spent: rules only.
    for words in ("몽글몽글한 느낌의 노래", "아련아련한 분위기 노래"):
        client.post("/api/parse", json={"category": "music", "text": words})
    assert reader.calls == 2 and db_session.scalars(select(UsageDaily.count).where(UsageDaily.bucket != "sweep:day")).all() == [2]
    after = client.post("/api/parse", json={"category": "music", "text": "포근포근한 감성의 노래"}).json()
    assert reader.calls == 2 and after["ai"] == "failed"
    # That refusal is this caller's alone: it is not kept, so a member sending the same sentence still gets the model.
    token = client.post("/api/auth/signup", json={"email": "lee@example.com", "password": "password1", "name": "주형"}).json()["token"]
    member = client.post("/api/parse", json={"category": "music", "text": "포근포근한 감성의 노래"}, headers={"Authorization": f"Bearer {token}"}).json()
    assert reader.calls == 3 and member["ai"] == "used"
    # And a sentence already answered costs nobody anything: the guest gets it from the cache.
    assert client.post("/api/parse", json={"category": "music", "text": "포근포근한 감성의 노래"}).json()["ai"] == "used" and reader.calls == 3


@needs_db
def test_an_answer_that_needs_no_model_costs_the_caller_nothing(api, db_session):
    client, model, _ = api
    pinned = db_session.scalars(text("SELECT id FROM items WHERE category = 'music' AND status = 'reviewed' ORDER BY id LIMIT 5")).all()
    for _ in range(4):  # more than the guest allowance of 2: every card is pinned, so the model is never asked
        meta = client.post("/api/recommend", json={**MUSIC, "pinnedIds": pinned}).json()["meta"]
        assert "limit" not in meta
    assert model.calls == 0 and db_session.scalars(select(UsageDaily.count).where(UsageDaily.bucket != "sweep:day")).all() == []


@needs_db
def test_past_the_allowance_the_paid_embedding_is_not_called_either(api):
    client, _, app = api
    embedded = []
    app.dependency_overrides[get_query_embedder] = lambda: (lambda words: embedded.append(words) or FakeEmbedder().embed([words])[0])
    food = {"category": "food", "raw": "비 오는 날 따뜻한 국물", "conditions": {"tags": [], "excluded": []}, "engine": "catalog"}
    app.dependency_overrides[get_rerank_model] = lambda: Recording({"picks": []})
    for _ in range(2):
        client.post("/api/recommend", json=food)
    assert len(embedded) == 2
    meta = client.post("/api/recommend", json={**food, "raw": "다른 문장으로 따뜻한 국물"}).json()["meta"]
    assert len(embedded) == 2 and meta["limit"] == "guest" and meta["contextSimilarity"] is False


def test_the_gate_charges_once_per_request_and_names_the_limit(counters):
    allowance = budget.Allowance(counters, "ai:g:test", 1, False)
    gate, inner = Gate(allowance), Recording()
    first, second = gate.model(inner), gate.model(Recording())
    first.generate_json("s", {}, {}); second.generate_json("s", {}, {}); first.generate_json("s", {}, {})
    assert budget.used(counters, "ai:g:test") == 1 and gate.limit() is None  # three calls of one request: one charge
    spent = Gate(allowance)
    assert spent.embedder(lambda words: [0.0])  # there is an embedder, but nothing is left to spend on it
    with pytest.raises(AllowanceSpent):
        spent.embedder(lambda words: [0.0])("문장")
    with pytest.raises(AllowanceSpent):
        spent.model(inner).generate_json("s", {}, {})
    assert inner.calls == 2 and spent.limit() == "guest"
    assert Gate(budget.Allowance(counters, "ai:u:1", 0, True)).model(None) is None
    # The service's own budget, met inside a call, is told apart from the caller's.
    service = Gate(budget.Allowance(counters, "ai:u:2", 5, True))
    with pytest.raises(BudgetSpent):
        service.model(BudgetedModel(Recording(), lambda: False)).generate_json("s", {}, {})
    assert service.limit() == "service"
    with pytest.raises(BudgetSpent):
        BudgetedEmbedder(None, lambda: False).embed(["문장"])


@needs_db
def test_on_postgresql_takes_arriving_together_stop_exactly_at_the_limit(test_database_url):
    from concurrent.futures import ThreadPoolExecutor

    engine = create_engine(test_database_url)
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE usage_daily"))
    make = sessionmaker(engine)

    def one(_):
        with make() as session:
            return budget.take(session, "ai:total", 5, DAY)

    with ThreadPoolExecutor(12) as pool:
        counts = list(pool.map(one, range(12)))
    assert sorted(c for c in counts if c is not None) == [1, 2, 3, 4, 5] and counts.count(None) == 7
    engine.dispose()
