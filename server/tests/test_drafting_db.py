import copy

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.catalog import load_seed, refresh_embeddings, seed_items
from app.db import get_session
from app.drafting import ALLERGEN_RULE, draft_items, export_review, import_review
from app.llm.draft import DraftInput
from app.main import create_app
from app.models import Item
from app.vocab import get_vocab
from tests.conftest import FakeEmbedder, needs_db

pytestmark = [pytest.mark.db, needs_db]


class DraftModel:
    """Drafts every requested label; `broken` labels get an unusable answer."""

    model = "fake-llm"

    def __init__(self, broken=(), fail=False):
        self.broken, self.fail, self.payloads = set(broken), fail, []

    def generate_json(self, system, payload, schema):
        self.payloads.append(payload)
        if self.fail:
            raise TimeoutError("slow")
        items = []
        for label in payload["items"]:
            if label in self.broken:
                items.append({"input": label, "description": "", "tags": []})
            elif " - " in label:
                items.append({"input": label, "description": "잔잔한 분위기의 곡.", "tags": ["차분함", "보컬", "발라드", "낮은 에너지"],
                              "emoji": "🎵", "color": "#e6e3df", "known": True})
            else:
                items.append({"input": label, "description": f"{label} 한 그릇.", "tags": ["따뜻함", "국물", "점심"], "ingredients": ["밀", "생선"],
                              "emoji": "🍜", "color": "#f0e9d6"})
        items.append({"input": "목록에 없던 메뉴", "description": "지어낸 메뉴", "tags": ["국물", "점심"]})
        return {"items": items}


@pytest.fixture
def catalog(db_session):
    seed_items(db_session, get_vocab(), load_seed())
    refresh_embeddings(db_session, FakeEmbedder())
    return db_session


def drafts(session):
    return session.scalars(select(Item).where(Item.status == "draft").order_by(Item.name)).all()


def test_drafts_are_created_in_batches_and_never_recommended(catalog):
    model = DraftModel(broken={"이상한 메뉴"})
    inputs = [DraftInput(n) for n in ["가케우동", "김치 볶음밥", "우동", "이상한 메뉴", "냉면"]]
    report = draft_items(catalog, model, FakeEmbedder(), get_vocab(), "food", inputs, batch_size=2)
    assert len(model.payloads) == 2  # 우동 already exists, so 4 names → 2 batches
    assert ("우동", "이미 카탈로그에 있음") in report.skipped and ("이상한 메뉴", "설명 또는 태그 부족") in report.skipped
    rows = drafts(catalog)
    assert sorted(r.name for r in rows) == sorted(["가케우동", "김치 볶음밥", "냉면"])  # the invented extra answer is ignored
    assert all(r.id.startswith("f-") and r.source == "ai_draft" and r.embedding is not None for r in rows)
    assert {tuple(r.ai_fields) for r in rows} == {("description", "tags", "ingredients", "emoji", "color")}
    with TestClient(_app(catalog)) as client:
        ids = {i["id"] for i in client.get("/api/catalog").json()["items"]}
    assert not ids & {r.id for r in rows}


def test_model_failure_skips_the_batch(catalog):
    report = draft_items(catalog, DraftModel(fail=True), None, get_vocab(), "food", [DraftInput("냉면")])
    assert report.created == [] and report.skipped == [("냉면", "모델 오류: TimeoutError")]


def test_export_marks_allergen_checks_and_duplicates(catalog):
    draft_items(catalog, DraftModel(), FakeEmbedder(), get_vocab(), "food", [DraftInput("가케우동")])
    draft_items(catalog, DraftModel(), FakeEmbedder(), get_vocab(), "music", [DraftInput("봄날의 곡", "아이유")])
    data = export_review(catalog)
    food, music = data["items"]
    assert food["allergensChecked"] is False and food["decision"] == "pending" and food["ingredients"] == ["밀", "생선"]
    assert any("알레르기" in n for n in food["notes"]) and any("이름이 비슷한 항목: 우동" in n for n in food["notes"])
    assert "allergensChecked" not in music and music["artist"] == "아이유"
    assert ALLERGEN_RULE in data["instructions"]


def test_import_requires_allergen_check_and_applies_edits(catalog):
    draft_items(catalog, DraftModel(), FakeEmbedder(), get_vocab(), "food", [DraftInput("가케우동"), DraftInput("냉면"), DraftInput("김밥")])
    data = export_review(catalog, "food")
    by_name = {i["name"]: i for i in data["items"]}
    gake, gimbap, naeng = by_name["가케우동"], by_name["김밥"], by_name["냉면"]
    gake |= {"decision": "approve"}                                                        # no allergen check → refused
    naeng |= {"decision": "approve", "allergensChecked": True, "tags": ["차가움", "국물", "점심"], "ingredients": ["메밀", "소고기"]}
    gimbap |= {"decision": "reject"}
    embedder = FakeEmbedder()
    report = import_review(catalog, get_vocab(), data, embedder)
    assert report.approved == [naeng["id"]] and report.rejected == [gimbap["id"]]
    assert report.errors == [(gake["id"], ALLERGEN_RULE)]
    approved = catalog.get(Item, naeng["id"])
    assert (approved.status, approved.tags, approved.ingredients) == ("reviewed", ["차가움", "국물", "점심"], ["메밀", "소고기"])
    assert report.embedded == [naeng["id"]]  # edited text → re-embedded
    assert catalog.get(Item, gake["id"]).status == "draft" and catalog.get(Item, gimbap["id"]).status == "rejected"
    with TestClient(_app(catalog)) as client:
        assert naeng["id"] in {i["id"] for i in client.get("/api/catalog", params={"category": "food"}).json()["items"]}


def test_import_refuses_stale_unknown_and_invalid_entries(catalog):
    draft_items(catalog, DraftModel(), FakeEmbedder(), get_vocab(), "food", [DraftInput("냉면"), DraftInput("김밥")])
    data = export_review(catalog, "food")
    first, second = sorted(data["items"], key=lambda i: i["id"])
    data["items"] = [first, second]
    stale = copy.deepcopy(data)
    first |= {"decision": "approve", "allergensChecked": True}
    import_review(catalog, get_vocab(), data, None)
    stale["items"][0] |= {"decision": "reject"}
    stale["items"][1] |= {"decision": "approve", "allergensChecked": True, "tags": ["없는태그"]}
    stale["items"].append({"id": "f-none", "decision": "approve"})
    stale["items"].append({**stale["items"][1], "id": second["id"], "decision": "maybe"})
    report = import_review(catalog, get_vocab(), stale, None)
    errors = report.errors
    assert (first["id"], "검수 대상이 아님 (현재 reviewed)") in errors  # an old export cannot undo an approval
    assert any(i == second["id"] and m.startswith("태그") for i, m in errors)
    assert (second["id"], "알 수 없는 decision: 'maybe'") in errors
    assert ("f-none", "없는 항목") in errors and report.approved == []


def test_import_refuses_renaming_onto_an_existing_item(catalog):
    draft_items(catalog, DraftModel(), FakeEmbedder(), get_vocab(), "food", [DraftInput("냉면")])
    data = export_review(catalog, "food")
    data["items"][0] |= {"decision": "approve", "allergensChecked": True, "name": "우동"}
    assert "같은 이름이 이미 있음: 우동" in import_review(catalog, get_vocab(), data, None).errors[0][1]


def _app(session):
    app = create_app()
    app.dependency_overrides[get_session] = lambda: session
    return app
