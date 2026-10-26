"""Offline evaluation: python -m app.cli.eval [--with-ai --ai-limit 10] [--out eval/report.md] [--full-catalog]

By default every mode only sees the bundled seed items (server/data/seed_items.json), because the gold
labels in eval/cases.json only know those; --full-catalog uses every reviewed item.

Without --with-ai only query embeddings are called (no generate quota). --with-ai adds the AI
rerank and /api/parse paths for up to --ai-limit cases each, paced for the free tier.
"""
import argparse
import json
from datetime import date
from pathlib import Path

from ..db import get_sessionmaker
from ..catalog import load_seed
from ..evaluation import load_cases, ranking_metrics, render_markdown, run_parsing, run_ranking
from ..llm.provider import shared_model
from ..routes.recommend import get_query_embedder
from ..vocab import get_vocab


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--with-ai", action="store_true", help="also evaluate AI rerank and parsing (uses generate quota)")
    parser.add_argument("--ai-limit", type=int, default=8, help="max cases per AI path")
    parser.add_argument("--pace", type=float, default=13.0, help="seconds between AI calls")
    parser.add_argument("--out", type=Path, help="write a markdown report")
    parser.add_argument("--json", type=Path, help="write per-case results")
    parser.add_argument("--full-catalog", action="store_true", help="rank over every reviewed item, not just the labelled seed")
    args = parser.parse_args()

    data, model = load_cases(), shared_model() if args.with_ai else None
    if args.with_ai and model is None:
        raise SystemExit("GEMINI_API_KEY is not set")
    modes = ["rule", "retrieval", "no_embedding", "taste_only", *(["rag"] if model else [])]
    with get_sessionmaker()() as session:
        catalog_ids = None if args.full_catalog else [i["id"] for i in load_seed()]
        ranking = run_ranking(session, data, get_query_embedder(), model, modes, args.ai_limit, args.pace, catalog_ids)
    parsing = run_parsing(data, get_vocab(), model, args.ai_limit, args.pace)
    note = f"실행일 {date.today().isoformat()} · " + ("전체 카탈로그 · " if args.full_catalog else "시드 31개 안에서 · ") + ("AI 경로 포함(사례 최대 %d개)" % args.ai_limit if model else "AI 경로 제외(생성 한도 사용 안 함)")
    report = render_markdown(data, ranking, parsing, note)
    print(report)
    if args.out:
        args.out.write_text(report, encoding="utf-8")
    if args.json:
        detail = {mode: {"metrics": {c: ranking_metrics(data, r, c) for c in ("food", "music")}, "cases": r.per_case} for mode, r in ranking.items()}
        args.json.write_text(json.dumps({"ranking": detail, "parsing": parsing}, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
