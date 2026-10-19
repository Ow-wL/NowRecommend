import pytest

from app.catalog import load_seed, refresh_embeddings, seed_items
from app.evaluation import load_cases, ranking_metrics, render_markdown, run_parsing, run_ranking
from app.models import RecommendationLog
from app.schemas import RecommendRequest
from app.vocab import get_vocab
from tests.conftest import FakeEmbedder, needs_db

DATA = load_cases()
SEED = {i["id"]: i for i in load_seed()}


def test_eval_set_shape():
    assert sum(c["category"] == "food" for c in DATA["cases"]) == 30 and sum(c["category"] == "music" for c in DATA["cases"]) == 30
    assert len({c["id"] for c in DATA["cases"]}) == 60


@pytest.mark.parametrize("case", DATA["cases"], ids=[c["id"] for c in DATA["cases"]])
def test_eval_cases_are_valid_and_acceptable_items_obey_the_gold_conditions(case):
    persona = DATA["personas"][case["persona"]]
    # Gold conditions and personas must be requests the API accepts.
    RecommendRequest(category=case["category"], raw=case["text"], conditions=case["conditions"],
                     profile={"selected": persona["selected"], "tags": persona["tags"]})
    assert all(SEED[i]["category"] == case["category"] for i in [*persona["selected"], *case["acceptable"]])
    k = case["conditions"]
    for item_id in case["acceptable"]:
        item = SEED[item_id]
        assert not set(k["excluded"]) & {*item["tags"], *item["ingredients"]}, item_id
        assert k["maxPrice"] is None or (item["cost"] or 0) <= k["maxPrice"], item_id


def test_rule_parser_scores_against_gold():
    result = run_parsing(DATA, get_vocab())
    assert result["service"] is None and result["rule"]["cases"] == 60
    assert 0 < result["rule"]["exact"] < 1  # the set contains phrases the rules are known to miss


@pytest.mark.db
@needs_db
def test_all_modes_run_without_hard_filter_violations(db_session):
    seed_items(db_session, get_vocab(), load_seed())
    fake = FakeEmbedder()
    refresh_embeddings(db_session, fake)
    ranking = run_ranking(db_session, DATA, lambda text: fake.embed([text])[0], None, ["rule", "retrieval", "taste_only", "rag"])
    assert "rag" in ranking and not ranking["rag"].per_case  # no model → skipped, not faked
    for mode in ("rule", "retrieval", "taste_only"):
        for category in ("food", "music"):
            metrics = ranking_metrics(DATA, ranking[mode], category)
            assert metrics["cases"] == 30 and metrics["violations"] == 0
            assert 0 <= metrics["precision"] <= 1
    assert db_session.query(RecommendationLog).count() == 0  # evaluation does not pollute the request log
    report = render_markdown(DATA, ranking, run_parsing(DATA, get_vocab()))
    assert "| 기존 규칙(브라우저) | 30 |" in report and "유사도+AI 재순위" not in report
