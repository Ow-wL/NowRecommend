"""Offline evaluation on server/eval/cases.json (plans-rag.md §11).

Ranking modes, all with the gold conditions so ranking is judged apart from parsing:
  rule        — the browser's recommend() scoring (tag counts), ported below; the pre-R2 baseline
  retrieval   — the R2 pipeline (embeddings + tags + MMR), τ=0, no model
  no_embedding — retrieval when the query embedding is unavailable (API error, no key): tags + taste
  taste_only  — retrieval without the sentence and wanted tags (hard exclusions/budget kept):
                the "취향만" arm of the proposal's comparison
  rag         — retrieval + AI rerank (costs one generate call per case; opt-in)
Metrics: precision@N (results that are acceptable), hit@N (≥1 acceptable), hard-filter violations,
latency. Parsing is measured separately against the gold conditions.
"""
import json
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from .llm.client import JsonModel
from .models import Item
from .parsing.rules import parse_rules
from .parsing.service import ParseService
from .recommend import PipelineConfig, recommend
from .retrieval.filters import eligible_query
from .schemas import RecommendRequest
from .vocab import Vocab

CASES_FILE = Path(__file__).resolve().parents[1] / "eval" / "cases.json"
COUNT = {"food": 3, "music": 5}
QUIET = PipelineConfig(write_log=False)


def load_cases(path: Path = CASES_FILE) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def rule_baseline(session: Session, case: dict, persona: dict) -> list[str]:
    """Port of recommend() in src/domain.ts for a fresh request (no seen/pinned)."""
    k = case["conditions"]
    rows = session.scalars(eligible_query(case["category"], k["excluded"], k["maxPrice"], [], [], None)).all()
    liked = session.scalars(select(Item).where(Item.id.in_(persona["selected"]))).all()
    preferred = set(persona["tags"]).union(*(r.tags for r in liked))
    score = lambda r: sum(t in preferred for t in r.tags) + 2 * sum(t in k["tags"] for t in r.tags)  # noqa: E731
    return [r.id for r in sorted(rows, key=lambda r: (-score(r), r.id))][: COUNT[case["category"]]]


def violations(session: Session, case: dict, ids: list[str]) -> int:
    k = case["conditions"]
    count = 0
    for row in session.scalars(select(Item).where(Item.id.in_(ids))):
        blocked = set(k["excluded"]) & {*row.tags, *row.ingredients}
        over_budget = k["maxPrice"] is not None and (row.cost is None or row.cost > k["maxPrice"])
        count += bool(blocked or over_budget or row.category != case["category"])
    return count


@dataclass
class ModeResult:
    mode: str
    per_case: dict[str, dict] = field(default_factory=dict)


def run_ranking(session: Session, data: dict, embed_query: Callable | None, model: JsonModel | None,
                modes: list[str], rag_limit: int | None = None, pace: float = 0.0) -> dict[str, ModeResult]:
    personas, results = data["personas"], {m: ModeResult(m) for m in modes}
    rag_done = 0
    for case in data["cases"]:
        persona = personas[case["persona"]]
        profile = {"selected": persona["selected"], "tags": persona["tags"], "disliked": []}
        for mode in modes:
            if mode == "rag" and (model is None or (rag_limit is not None and rag_done >= rag_limit)):
                continue
            started = time.perf_counter()
            meta = {}
            if mode == "rule":
                ids = rule_baseline(session, case, persona)
            else:
                k = case["conditions"]
                situational = mode != "taste_only"
                request = RecommendRequest(category=case["category"], raw=case["text"] if situational else "", tau=0, profile=profile,
                                           conditions={**k, "tags": k["tags"] if situational else []})
                if mode == "rag" and rag_done and pace:
                    time.sleep(pace)  # free tier: ~5 generate requests/minute
                embed = None if mode == "no_embedding" else embed_query
                response = recommend(session, request, embed, QUIET, rerank_model=model if mode == "rag" else None)
                ids, meta = [r["item"]["id"] for r in response["results"]], response["meta"]
                rag_done += mode == "rag"
            results[mode].per_case[case["id"]] = {"ids": ids, "ms": (time.perf_counter() - started) * 1000,
                                                  "violations": violations(session, case, ids), "mode": meta.get("mode", mode)}
    return results


def ranking_metrics(data: dict, result: ModeResult, category: str) -> dict | None:
    cases = [c for c in data["cases"] if c["category"] == category and c["id"] in result.per_case]
    if not cases:
        return None
    precisions, hits, latencies, violations_total, fallbacks = [], 0, [], 0, 0
    for case in cases:
        run = result.per_case[case["id"]]
        good = sum(i in case["acceptable"] for i in run["ids"])
        precisions.append(good / len(run["ids"]) if run["ids"] else 0.0)
        hits += good > 0
        latencies.append(run["ms"])
        violations_total += run["violations"]
        fallbacks += result.mode == "rag" and run["mode"] != "rag"
    latencies.sort()
    return {"cases": len(cases), "precision": sum(precisions) / len(cases), "hit": hits / len(cases), "violations": violations_total,
            "p50_ms": latencies[len(latencies) // 2], "p95_ms": latencies[min(len(latencies) - 1, int(len(latencies) * 0.95))],
            "fallbacks": fallbacks}


def run_parsing(data: dict, vocab: Vocab, model: JsonModel | None = None, limit: int | None = None, pace: float = 0.0) -> dict:
    """Gold-condition agreement of the rule parser and, if a model is given, of /api/parse."""
    service, rows, ai_calls = ParseService(), [], 0
    for case in data["cases"]:
        gold = case["conditions"]
        rule = parse_rules(case["text"], case["category"]).conditions()
        row = {"id": case["id"], "gold": gold, "rule": rule}
        if model is not None and (limit is None or ai_calls < limit):
            answer = service.parse(case["category"], case["text"], vocab, model)
            if answer["ai"] in ("used", "failed"):
                ai_calls += 1
                if pace:
                    time.sleep(pace)
            row["service"], row["ai"] = answer["conditions"], answer["ai"]
        rows.append(row)
    return {"rows": rows, "rule": _parse_scores(rows, "rule"), "service": _parse_scores([r for r in rows if "service" in r], "service")}


def _parse_scores(rows: list[dict], key: str) -> dict | None:
    if not rows:
        return None
    tp = fp = fn = ex_hit = ex_total = budget_ok = exact = 0
    for row in rows:
        gold, got = row["gold"], row[key]
        tp += len(set(gold["tags"]) & set(got["tags"]))
        fp += len(set(got["tags"]) - set(gold["tags"]))
        fn += len(set(gold["tags"]) - set(got["tags"]))
        ex_total += len(gold["excluded"])
        ex_hit += len(set(gold["excluded"]) & set(got["excluded"]))
        budget_ok += gold["maxPrice"] == got["maxPrice"]
        exact += set(gold["tags"]) == set(got["tags"]) and set(gold["excluded"]) == set(got["excluded"]) and gold["maxPrice"] == got["maxPrice"]
    return {"cases": len(rows), "tag_precision": tp / (tp + fp) if tp + fp else 1.0, "tag_recall": tp / (tp + fn) if tp + fn else 1.0,
            "exclusion_recall": ex_hit / ex_total if ex_total else 1.0, "budget_accuracy": budget_ok / len(rows), "exact": exact / len(rows)}


def render_markdown(data: dict, ranking: dict[str, ModeResult], parsing: dict, note: str = "") -> str:
    labels = {"rule": "기존 규칙(브라우저)", "retrieval": "유사도 검색", "no_embedding": "유사도 검색(문장 임베딩 실패 시)",
              "taste_only": "취향만", "rag": "유사도+AI 재순위"}
    lines = ["# 지금 추천 — 오프라인 평가 결과", "", note, "",
             f"평가 세트: `server/eval/cases.json` (음식 {sum(c['category'] == 'food' for c in data['cases'])}·음악 {sum(c['category'] == 'music' for c in data['cases'])}개, 정답 조건 사용, τ=0)", ""]
    for category, n in COUNT.items():
        lines += [f"## 추천 순위 — {'음식' if category == 'food' else '음악'} (상위 {n}개)", "",
                  "| 방식 | 사례 | 정밀도@N | 적중률@N | 필수 제외 위반 | p50 | p95 | 대체 |", "|---|---|---|---|---|---|---|---|"]
        for mode, result in ranking.items():
            if m := ranking_metrics(data, result, category):
                lines.append(f"| {labels[mode]} | {m['cases']} | {m['precision']:.2f} | {m['hit']:.2f} | {m['violations']} | {m['p50_ms']:.0f}ms | {m['p95_ms']:.0f}ms | {m['fallbacks'] if mode == 'rag' else '-'} |")
        lines.append("")
    lines += ["## 조건 해석 (정답 조건 대비)", "", "| 해석기 | 사례 | 태그 정밀도 | 태그 재현율 | 제외 재현율 | 예산 정확도 | 완전 일치 |", "|---|---|---|---|---|---|---|"]
    for key, label in (("rule", "규칙 파서"), ("service", "/api/parse (규칙+AI)")):
        if s := parsing[key]:
            lines.append(f"| {label} | {s['cases']} | {s['tag_precision']:.2f} | {s['tag_recall']:.2f} | {s['exclusion_recall']:.2f} | {s['budget_accuracy']:.2f} | {s['exact']:.2f} |")
    misses = [r for r in parsing["rows"] if set(r["gold"]["excluded"]) - set(r["rule"]["excluded"])]
    if misses:
        lines += ["", "규칙 파서가 놓친 필수 제외:", ""] + [f"- {r['id']}: {sorted(set(r['gold']['excluded']) - set(r['rule']['excluded']))}" for r in misses]
    return "\n".join(lines) + "\n"
