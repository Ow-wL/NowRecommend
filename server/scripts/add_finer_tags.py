"""Adds the finer condition tags of 2026-11-10 (해장·든든함·가벼움·야식, 드라이브·출퇴근·새벽·감성) to the catalog.

Each list was chosen by hand from the item's name, artist, description and existing tags. The script only appends a tag an item
does not have yet, so it can run again after another branch rewrites server/data/reviewed_items.json:

  python server/scripts/add_finer_tags.py          (then: npx vite-node scripts/export-catalog.ts for seed_items.json)

src/data.ts holds the bundled items (f01–f16, m01–m15); server/data/seed_items.json is exported from it.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REVIEWED = ROOT / "server" / "data" / "reviewed_items.json"
BUNDLED = ROOT / "src" / "data.ts"

ADDITIONS: dict[str, list[str]] = {
    # Food: what a hangover, a hungry evening, a light meal or a late snack is usually answered with.
    "해장": ["f01", "f-kongnamul", "f-yukgaejang", "f-jjamppong", "f-sundubu", "f-gamjatang", "f-naengmyeon", "f-ramyeon"],
    "든든함": ["f04", "f07", "f16", "f-kimbap", "f-jeyuk", "f-bulgogi", "f-samgyeopsal", "f-budae", "f-galbitang", "f-samgyetang",
              "f-gamjatang", "f-jjimdak", "f-dakgalbi", "f-jajang", "f-ramen", "f-tonkatsu", "f-gyudon", "f-burger", "f-omurice",
              "f-indiancurry"],
    "가벼움": ["f01", "f05", "f09", "f10", "f12", "f15", "f-salad", "f-hoedeopbap", "f-buncha", "f-dimsum"],
    "야식": ["f11", "f13", "f-jokbal", "f-bossam", "f-pizza", "f-ramyeon", "f-sundae", "f-twigim", "f-yangkkochi", "f-takoyaki", "f-mandu"],
    # Music: songs whose mood or subject fits the moment, not every song of a matching energy.
    "감성": ["m01", "m05", "m15", "m-03847fd1", "m-04eec938", "m-05355684", "m-0d82e57d", "m-16ce1e45", "m-1b88647c", "m-1c6a79bd",
           "m-2a2aec88", "m-2db1a384", "m-357e4c04", "m-374387e9", "m-3ba2a1c8", "m-412092fb", "m-428ebad4", "m-434f7f0f",
           "m-4b4f0b68", "m-4fb64496", "m-574ee71b", "m-5a4505fd", "m-5cc80699", "m-6166546f", "m-64c8f49c", "m-6ae4aa12",
           "m-7d89c22f", "m-7e5f1666", "m-82f7e2c4", "m-89c1323f", "m-9f3841b3", "m-9f563451", "m-acace23e", "m-accc8f52",
           "m-b0b7f7e9", "m-b65367f3", "m-c37d837a", "m-c4c6e1e8", "m-c63a9ef5", "m-cdbbfd06", "m-d5649425", "m-d9fcae1b",
           "m-dba94a0b", "m-e6da2635", "m-f83649a8", "m-ffe91544"],
    "새벽": ["m01", "m07", "m11", "m12", "m15", "m-1b88647c", "m-1c6a79bd", "m-23f50c1a", "m-3123061b", "m-6166546f", "m-64c8f49c",
           "m-6c4bf357", "m-79b798c8", "m-89c1323f", "m-8fd2c886", "m-9f3841b3", "m-accc8f52", "m-b04997e8", "m-c0168615",
           "m-c69e2ba1", "m-e8ddd1be", "m-f363742a", "m-ff9122d2", "m-ffe91544"],
    "드라이브": ["m02", "m-09dac156", "m-1ddffa5e", "m-1eadf3ab", "m-1f881a1a", "m-24d7a7fe", "m-2f864ee1", "m-342eba26", "m-34dec903",
             "m-404ef916", "m-105e2471", "m-5d163a38", "m-742aaf27", "m-7562c78f", "m-762506ef", "m-7fcbc846", "m-80c96349",
             "m-82ab5c56", "m-84b8a267", "m-8e6ac306", "m-91068b3e", "m-957cf5fa", "m-ab445833", "m-b429580f", "m-bb8944fb",
             "m-d02962e2", "m-d45a0a4f", "m-d83a145c", "m-dc992ae6", "m-e7eb696a", "m-ea8faadf", "m-ec34ae54", "m-fb471b3b"],
    "출퇴근": ["m13", "m-0d17a46b", "m-21c9bd75", "m-3457ab04", "m-50c33267", "m-5a4505fd", "m-5b119671", "m-5d163a38", "m-6998a76d",
            "m-6ad51e02", "m-7fcbc846", "m-7fb701e4", "m-82ab5c56", "m-885ac74e", "m-986573fd", "m-9f3841b3", "m-a309adf8",
            "m-a92cdf71", "m-a99d74e7", "m-ab445833", "m-b0b7f7e9", "m-b429580f", "m-bc9ea8bf", "m-bf3b24bc", "m-c73eef72",
            "m-cb5b3325", "m-d83a145c", "m-ec34ae54", "m-f7e81c49", "m-fb471b3b"],
}


def wanted() -> dict[str, list[str]]:
    by_id: dict[str, list[str]] = {}
    for tag, ids in ADDITIONS.items():
        for item_id in ids:
            by_id.setdefault(item_id, []).append(tag)
    return by_id


def main() -> None:
    by_id, found, changed = wanted(), set(), 0
    data = json.loads(REVIEWED.read_text(encoding="utf-8"))
    for item in data["items"]:
        for tag in by_id.get(item["id"], []):
            found.add(item["id"])
            if tag not in item["tags"]:
                item["tags"].append(tag)
                changed += 1
    REVIEWED.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")

    source = BUNDLED.read_text(encoding="utf-8")
    for item_id, tags in by_id.items():
        # food('f01', name, emoji, description, [tags], ...) / music('m01', name, artist, emoji, [tags], color)
        match = re.search(rf"(?:food|music)\('{re.escape(item_id)}',[^\[]*\[([^\]]*)\]", source)
        if not match:
            continue
        found.add(item_id)
        listed = re.findall(r"'([^']+)'", match.group(1))
        new = [t for t in tags if t not in listed]
        if new:
            inner = match.group(1) + "".join(f", '{t}'" for t in new)
            source = source[: match.start(1)] + inner + source[match.end(1):]
            changed += len(new)
    BUNDLED.write_text(source, encoding="utf-8", newline="\n")

    missing = sorted(set(by_id) - found)
    print(f"added {changed} tags; {len(found)} items listed")
    if missing:
        sys.exit(f"unknown ids: {', '.join(missing)}")


if __name__ == "__main__":
    main()
