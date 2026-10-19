"""Review AI drafts.

  python -m app.cli.review export [--category food] [--out data/drafts/review.json]
  python -m app.cli.review import data/drafts/review.json [--no-embed]

Edit the exported file: set decision to approve / reject / pending, fix fields if needed, and for food
set allergensChecked to true only after checking the ingredients. Approved items are embedded and
start appearing in /api/catalog and recommendations.
"""
import argparse
import json
from pathlib import Path

from ..config import get_settings
from ..db import get_sessionmaker
from ..drafting import DUPLICATE_THRESHOLD, export_review, import_review
from ..embeddings import GeminiEmbedder
from ..vocab import get_vocab

DEFAULT_FILE = Path("data/drafts/review.json")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    export = commands.add_parser("export")
    export.add_argument("--category", choices=["food", "music"])
    export.add_argument("--out", type=Path, default=DEFAULT_FILE)
    export.add_argument("--threshold", type=float, default=DUPLICATE_THRESHOLD, help="embedding similarity that warns of a duplicate")
    load = commands.add_parser("import")
    load.add_argument("file", type=Path, nargs="?", default=DEFAULT_FILE)
    load.add_argument("--no-embed", action="store_true")
    args = parser.parse_args()

    with get_sessionmaker()() as session:
        if args.command == "export":
            data = export_review(session, args.category, args.threshold)
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            warned = sum(bool(i["notes"]) for i in data["items"])
            print(f"exported {len(data['items'])} drafts to {args.out} ({warned} with notes)")
            return
        settings = get_settings()
        embedder = None if args.no_embed or not settings.gemini_api_key else GeminiEmbedder(settings.gemini_api_key, settings.embedding_model, settings.embedding_dim)
        report = import_review(session, get_vocab(), json.loads(args.file.read_text(encoding="utf-8")), embedder)
    print(f"approved {len(report.approved)}, rejected {len(report.rejected)}, pending {report.pending}, embedded {len(report.embedded)}")
    for item_id, message in report.errors:
        print(f"  not applied {item_id}: {message}")


if __name__ == "__main__":
    main()
