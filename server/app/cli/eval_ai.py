"""Product evaluation, step by step (server/eval/ai_cases.json). Each step saves as it goes and continues where it stopped.

  python -m app.cli.eval_ai run NAME [--engine ai|catalog] [--limit N] [--only food|exclusion|FS] [--pace 6]
  python -m app.cli.eval_ai judge NAME [--judge-model gemini-3.6-flash] [--limit N] [--pace 13]
  python -m app.cli.eval_ai songs NAME [--again]
  python -m app.cli.eval_ai report NAME [NAME ...] [--out eval/ai_report.md]
  python -m app.cli.eval_ai check NAME --against BASELINE    (exit 1 when something got worse than run-to-run noise)
  python -m app.cli.eval_ai review NAME [NAME ...] [--redraw]   (human review page: eval/review/review.html)
  python -m app.cli.eval_ai agree NAME [NAME ...] [--human eval/review/human.json]

`review` draws a sample of judged picks once (eval/review/sample.json; --redraw replaces it) and builds the page from
eval/review/template.html. The page saves verdicts; put its JSON at eval/review/human.json. `agree` and `report` then compare the
judge with the human verdicts; eval/review/findings.md, the written reading of them, follows the tables.

`run` with the AI engine uses the model production uses (LLM_MODEL) and writes nothing to the database; --engine catalog needs the
database. Runs live in eval/runs/NAME.json.
"""
import argparse
import json
import sys
from datetime import date
from pathlib import Path

from ..config import get_settings
from ..evaluation_ai import (REVIEW_DIR, RUNS_DIR, answer_ai, answer_catalog, build_review_page, check_songs, draw_review_sample, human_agreement, item_labels, judge_run,
                             load_ai_cases, load_human, load_run, regressions, render_agreement, render_report, review_page_data, reviewed_dishes, run_cases, save_run)
from ..llm.client import GeminiJsonModel
from ..llm.provider import shared_model
from ..song_store import song_store

DEFAULT_JUDGE = "gemini-3.6-flash"


def _review_inputs() -> tuple[dict, dict]:
    """The sample names its runs, so agreement always reads the judge verdicts the reviewer was shown."""
    sample = json.loads((REVIEW_DIR / "sample.json").read_text(encoding="utf-8"))
    return sample, {n: load_run(RUNS_DIR / f"{n}.json") for n in sample["meta"]["runs"]}


def _findings() -> str:
    """The written reading of the agreement numbers, kept beside the verdicts and placed after the tables."""
    path = REVIEW_DIR / "findings.md"
    return path.read_text(encoding="utf-8") if path.exists() else ""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("step", choices=("run", "judge", "songs", "report", "check", "review", "agree"))
    parser.add_argument("names", nargs="+")
    parser.add_argument("--engine", choices=("ai", "catalog"), default="ai")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--only", default="", help="a category, a kind, or an id prefix")
    parser.add_argument("--pace", type=float, help="seconds between calls")
    parser.add_argument("--judge-model", default=DEFAULT_JUDGE)
    parser.add_argument("--out", help="write the report to this file")
    parser.add_argument("--against", help="baseline run for check")
    parser.add_argument("--redraw", action="store_true", help="review: draw a new sample even if one exists")
    parser.add_argument("--human", default=str(REVIEW_DIR / "human.json"), help="human verdicts saved by the review page")
    parser.add_argument("--again", action="store_true", help="songs: ask once more for the songs marked missing")
    args = parser.parse_args()

    sys.stdout.reconfigure(encoding="utf-8")
    data, settings = load_ai_cases(), get_settings()
    name, path = args.names[0], RUNS_DIR / f"{args.names[0]}.json"

    if args.step == "run":
        pace = 6.0 if args.pace is None else args.pace
        if args.engine == "ai":
            model = shared_model()
            if model is None:
                raise SystemExit("GEMINI_API_KEY is not set")
            run = load_run(path, {"engine": "ai", "model": model.model, "date": date.today().isoformat()})
            labels, dishes = item_labels(), reviewed_dishes()
            store = song_store()  # as production: SONG_STORE_CHECK=false measures the model alone
            run["meta"].setdefault("songStore", store is not None)
            run_cases(data, run, path, lambda case: answer_ai(data, case, model, labels, dishes, store=store), args.limit, args.only, pace)
        else:
            from ..db import get_sessionmaker
            from ..routes.recommend import get_query_embedder

            run = load_run(path, {"engine": "catalog", "date": date.today().isoformat()})
            with get_sessionmaker()() as session:
                run_cases(data, run, path, lambda case: answer_catalog(data, case, session, get_query_embedder()), args.limit, args.only, pace)
    elif args.step == "judge":
        if not settings.gemini_api_key:
            raise SystemExit("GEMINI_API_KEY is not set")
        run = load_run(path)
        run["meta"]["judge"] = args.judge_model
        done, failed = judge_run(data, run, path, GeminiJsonModel(settings.gemini_api_key, args.judge_model, timeout_ms=90000), item_labels(), args.limit, 13.0 if args.pace is None else args.pace)
        print(f"judged {done}, failed {failed}")
    elif args.step == "songs":
        run = load_run(path)
        print(f"asked {check_songs(data, run, path, 3.5 if args.pace is None else args.pace, again=args.again)} songs")
    elif args.step == "review":
        sample_path = REVIEW_DIR / "sample.json"
        if sample_path.exists() and not args.redraw:
            sample = json.loads(sample_path.read_text(encoding="utf-8"))
            runs = {n: load_run(RUNS_DIR / f"{n}.json") for n in sample["meta"]["runs"]}
        else:
            runs = {n: load_run(RUNS_DIR / f"{n}.json") for n in args.names}
            sample = draw_review_sample(data, runs)
            save_run(sample_path, sample)
        page = build_review_page((REVIEW_DIR / "template.html").read_text(encoding="utf-8"), review_page_data(data, runs, sample, item_labels()))
        (REVIEW_DIR / "review.html").write_text(page, encoding="utf-8", newline="\n")
        print(f"{len(sample['items'])} items -> {REVIEW_DIR / 'review.html'}")
    elif args.step == "agree":
        sample, runs = _review_inputs()
        print("\n".join(render_agreement(human_agreement(data, runs, sample, load_human(Path(args.human))), _findings())))
    elif args.step == "report":
        runs = {n: load_run(RUNS_DIR / f"{n}.json") for n in args.names}
        agreement = None
        if Path(args.human).exists():
            sample, sample_runs = _review_inputs()
            agreement = human_agreement(data, sample_runs, sample, load_human(Path(args.human)))
        report = render_report(data, runs, f"실행일 {date.today().isoformat()}", agreement, _findings() if agreement else "")
        print(report)
        if args.out:
            with open(args.out, "w", encoding="utf-8", newline="\n") as out:
                out.write(report)
    else:
        if not args.against:
            raise SystemExit("--against BASELINE is required")
        found = regressions(data, load_run(path), load_run(RUNS_DIR / f"{args.against}.json"))
        print("\n".join(found) or "기준선보다 나빠진 항목이 없어요.")
        raise SystemExit(1 if found else 0)


if __name__ == "__main__":
    main()
