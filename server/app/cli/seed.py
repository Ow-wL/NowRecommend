"""Load the catalog into items as reviewed data: python -m app.cli.seed

server/data/seed_items.json (the bundled sample, mirrors src/data.ts) and then, if present,
server/data/reviewed_items.json (approved AI drafts written by app.cli.review publish). Approved drafts that
are no longer in that file are taken out of the catalog.
"""
import argparse
from pathlib import Path

from ..catalog import REVIEWED_FILE, SEED_FILE, load_seed, retire_unpublished, seed_items
from ..db import get_sessionmaker
from ..vocab import get_vocab


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--file", type=Path, default=SEED_FILE)
    parser.add_argument("--reviewed", type=Path, default=REVIEWED_FILE, help="approved drafts; skipped if missing")
    args = parser.parse_args()
    published = load_seed(args.reviewed) if args.reviewed.exists() else None
    with get_sessionmaker()() as session:
        result = seed_items(session, get_vocab(), load_seed(args.file) + (published or []))
        # Only with a file present: a missing file must not take every approved draft out of the catalog.
        retired = retire_unpublished(session, [i["id"] for i in published]) if published is not None else []
    print(f"seed: inserted {result.inserted}, updated {result.updated}, unchanged {result.unchanged}, retired {len(retired)}")


if __name__ == "__main__":
    main()
