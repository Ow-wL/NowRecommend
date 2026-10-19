import numpy as np
import pytest

from app.retrieval.scoring import Candidate, Weights, mean_vector, score_candidates
from app.retrieval.select import SelectionParams, select_candidates


def unit(*values):
    v = np.array(values, dtype=float)
    return v / np.linalg.norm(v)


def scores(candidates, context=None, taste=None, tags=(), liked=()):
    return {s.id: s for s in score_candidates(candidates, context, taste, tags, liked)}


def test_context_similarity_is_minmax_normalised():
    candidates = [Candidate("a", [], unit(1, 0)), Candidate("b", [], unit(1, 1)), Candidate("c", [], unit(0, 1))]
    result = scores(candidates, context=unit(1, 0))
    assert result["a"].score == pytest.approx(1) and result["c"].score == pytest.approx(0)
    assert 0 < result["b"].score < 1 and set(result["a"].parts) == {"context"}


def test_missing_components_redistribute_weight():
    candidates = [Candidate("a", ["국물", "담백함"], None), Candidate("b", ["국물"], None), Candidate("c", [], None)]
    result = scores(candidates, tags=["국물", "담백함"])
    assert [round(result[i].score, 2) for i in "abc"] == [1.0, 0.5, 0.0]


def test_taste_combines_vector_and_profile_tags():
    candidates = [Candidate("a", ["매콤함"], unit(1, 0)), Candidate("b", [], unit(0, 1))]
    result = scores(candidates, taste=unit(1, 0), liked=["매콤함"])
    assert result["a"].parts["taste"] == pytest.approx(1) and result["b"].parts["taste"] == pytest.approx(0)


def test_weights_follow_plan_defaults():
    candidates = [Candidate("a", ["국물"], unit(1, 0)), Candidate("b", [], unit(0, 1))]
    result = scores(candidates, context=unit(0, 1), taste=unit(1, 0), tags=["국물"])
    w = Weights()
    assert result["a"].score == pytest.approx(w.taste + w.tag)
    assert result["b"].score == pytest.approx(w.context)


def test_no_signal_keeps_id_order():
    candidates = [Candidate(i, [], None) for i in ["f03", "f01", "f02"]]
    picked = select_candidates(score_candidates(candidates, None, None, [], []), {}, set(), [], 3, SelectionParams(tau=0))
    assert picked == ["f01", "f02", "f03"]


def pool():
    # a and a2 are near-duplicates at the top; b is slightly less relevant but different.
    candidates = [Candidate("a", [], unit(1, 0, 0)), Candidate("a2", [], unit(0.99, 0.14, 0)),
                  Candidate("b", [], unit(0.6, 0, 0.8)), Candidate("c", [], unit(0, 1, 0))]
    scored = score_candidates(candidates, unit(1, 0.05, 0.3), None, [], [])
    return scored, {c.id: c.vector for c in candidates}


def test_mmr_prefers_variety_over_near_duplicates():
    scored, vectors = pool()
    assert select_candidates(scored, vectors, set(), [], 2, SelectionParams(tau=0, mmr_lambda=1.0)) == ["a", "a2"]
    assert select_candidates(scored, vectors, set(), [], 2, SelectionParams(tau=0, mmr_lambda=0.7)) == ["a", "b"]


def test_zero_temperature_is_deterministic_and_positive_temperature_explores():
    scored, vectors = pool()
    params = SelectionParams(tau=0)
    runs = {tuple(select_candidates(scored, vectors, set(), [], 2, params, np.random.default_rng(s))) for s in range(20)}
    assert len(runs) == 1
    hot = SelectionParams(tau=1.0)
    runs = {tuple(select_candidates(scored, vectors, set(), [], 2, hot, np.random.default_rng(s))) for s in range(20)}
    assert len(runs) > 1


def test_tiers_pinned_then_unseen_then_seen():
    scored, vectors = pool()
    picked = select_candidates(scored, vectors, seen={"a", "b"}, pinned=["c"], limit=4, params=SelectionParams(tau=0.5),
                               rng=np.random.default_rng(1))
    assert picked[0] == "c" and picked[1] == "a2" and set(picked[2:]) == {"a", "b"}


def test_pinned_items_that_are_no_longer_eligible_are_dropped():
    scored, vectors = pool()
    assert select_candidates(scored, vectors, set(), ["gone", "b"], 2, SelectionParams(tau=0))[0] == "b"


def test_mean_vector_is_normalised():
    assert np.linalg.norm(mean_vector([unit(1, 0), unit(0, 1)])) == pytest.approx(1)
    assert mean_vector([]) is None


def test_missing_sentence_vector_hands_its_weight_to_the_tags():
    # a matches the wanted tag, b matches the taste; without a sentence vector the situation must still win.
    candidates = [Candidate("a", ["담백함"], unit(0, 1)), Candidate("b", [], unit(1, 0))]
    result = scores(candidates, context=None, taste=unit(1, 0), tags=["담백함"])
    w = Weights()
    assert result["a"].score == pytest.approx((w.tag + w.context) / (w.tag + w.context + w.taste))
    assert result["b"].score == pytest.approx(w.taste / (w.tag + w.context + w.taste))
    assert result["a"].score > result["b"].score
