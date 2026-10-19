"""Load server/data/seed_items.json into items as reviewed seed data: python -m app.cli.seed"""
import argparse
from pathlib import Path

from ..catalog import SEED_FILE, load_seed, seed_items
from ..db import get_sessionmaker
from ..vocab import get_vocab


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", type=Path, default=SEED_FILE)
    args = parser.parse_args()
    with get_sessionmaker()() as session:
        result = seed_items(session, get_vocab(), load_seed(args.file))
    print(f"seed: inserted {result.inserted}, updated {result.updated}, unchanged {result.unchanged}")


if __name__ == "__main__":
    main()
