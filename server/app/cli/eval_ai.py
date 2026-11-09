"""Product evaluation, step by step (server/eval/ai_cases.json). Each step saves as it goes and continues where it stopped.

  python -m app.cli.eval_ai run NAME [--engine ai|catalog] [--limit N] [--only food|exclusion|FS] [--pace 6]
  python -m app.cli.eval_ai judge NAME [--judge-model gemini-3.6-flash] [--limit N] [--pace 13]
  python -m app.cli.eval_ai songs NAME
  python -m app.cli.eval_ai report NAME [NAME ...] [--out eval/ai_report.md]
  python -m app.cli.eval_ai check NAME --against BASELINE    (exit 1 when something got worse than run-to-run noise)

`run` with the AI engine uses the model production uses (LLM_MODEL) and writes nothing to the database; --engine catalog needs the
database. Runs live in eval/runs/NAME.json.
"""
import argparse
import sys
from datetime import date

from ..config import get_settings
from ..evaluation_ai import (RUNS_DIR, answer_ai, answer_catalog, check_songs, item_labels, judge_run, load_ai_cases, load_run, regressions, render_report,
                             reviewed_dishes, run_cases)
from ..llm.client import GeminiJsonModel
from ..llm.provider import shared_model

DEFAULT_JUDGE = "gemini-3.6-flash"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("step", choices=("run", "judge", "songs", "report", "check"))
    parser.add_argument("names", nargs="+")
    parser.add_argument("--engine", choices=("ai", "catalog"), default="ai")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--only", default="", help="a category, a kind, or an id prefix")
    parser.add_argument("--pace", type=float, help="seconds between calls")
    parser.add_argument("--judge-model", default=DEFAULT_JUDGE)
    parser.add_argument("--out", help="write the report to this file")
    parser.add_argument("--against", help="baseline run for check")
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
            run_cases(data, run, path, lambda case: answer_ai(data, case, model, labels, dishes), args.limit, args.only, pace)
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
        print(f"asked {check_songs(data, run, path, 3.5 if args.pace is None else args.pace)} songs")
    elif args.step == "report":
        runs = {n: load_run(RUNS_DIR / f"{n}.json") for n in args.names}
        report = render_report(data, runs, f"실행일 {date.today().isoformat()}")
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
