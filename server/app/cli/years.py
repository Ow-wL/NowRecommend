"""Fill in release years for the music catalog: python -m app.cli.years [--apply]

Reads each song's page from src/media.json, asks the iTunes lookup API for its release date, then looks through the same
artist's list for the same title: a re-release or a compilation carries a later date, so the earliest one wins. Songs with no
song page are left without a year. --apply writes `release_year` into server/data/reviewed_items.json; the seed then loads
it. The seed file mirrors src/data.ts, so its years are printed for that file instead. Run from a machine, not the API.
"""
import argparse
import json
import re
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

from ..catalog import REVIEWED_FILE, SEED_FILE

MEDIA_FILE = Path(__file__).resolve().parents[3] / "src" / "media.json"
AGENT = {"User-Agent": "NowRecommend-catalog/1.0 (https://github.com/Ow-wL/NowRecommend)"}
PAUSE_SECONDS = 3.5  # the public API allows about 20 requests a minute
VERSION = re.compile(r"\b(live|remix|mixed|acoustic|karaoke|instrumental|inst|ver|version|sped|slowed|demo|edit|cover|tribute)\b|라이브|리믹스", re.I)
SONG_ID = re.compile(r"/song/[^/]+/(\d+)$")


def norm(text: str | None) -> str:
    return re.sub(r"[\W_]+", "", unicodedata.normalize("NFKC", text or "").casefold())


def base_title(text: str | None) -> str:
    return norm(re.sub(r"\s*[(\[](?:feat\.?|ft\.?|with|from)\b[^)\]]*[)\]]", "", text or "", flags=re.I))


def year_of(hit: dict) -> int | None:
    match = re.match(r"(\d{4})-", hit.get("releaseDate") or "")
    return int(match.group(1)) if match else None


def lookup(**params) -> list[dict]:
    url = "https://itunes.apple.com/lookup?" + urllib.parse.urlencode(params)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=AGENT), timeout=40) as response:
                results = json.load(response).get("results", [])
            time.sleep(PAUSE_SECONDS)
            return [r for r in results if r.get("wrapperType") == "track"]
        except OSError:
            time.sleep(25 * (attempt + 1))
    return []


def earliest(titles: set[str], own_year: int, listed: list[dict]) -> int:
    """The earliest year among same-titled tracks that are not a named version of the song."""
    years = [y for r in listed if base_title(r.get("trackName")) in titles and not VERSION.search(r.get("trackName") or "") and (y := year_of(r))]
    return min([own_year, *years])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    media = json.loads(MEDIA_FILE.read_text(encoding="utf-8"))
    reviewed = json.loads(REVIEWED_FILE.read_text(encoding="utf-8"))
    seed = json.loads(SEED_FILE.read_text(encoding="utf-8"))
    songs = {i["id"]: i for i in [*seed["items"], *reviewed["items"]] if i["category"] == "music"}
    linked = {k: m.group(1) for k in songs if (m := SONG_ID.search(media.get(k, {}).get("link", "")))}
    store_of = {k: re.search(r"apple\.com/([a-z]{2})/", media[k]["link"]).group(1) for k in linked}
    hits: dict[str, dict] = {}
    for store in sorted(set(store_of.values())):
        ids = [linked[k] for k in linked if store_of[k] == store]
        for start in range(0, len(ids), 150):
            for hit in lookup(id=",".join(ids[start:start + 150]), country=store, entity="song"):
                hits[str(hit["trackId"])] = hit
    lists: dict[int, list[dict]] = {}
    years: dict[str, int] = {}
    for key, track in linked.items():
        hit = hits.get(track)
        own = hit and year_of(hit)
        if not own:
            print(f"no date: {key} {songs[key]['name']}")
            continue
        artist = hit["artistId"]
        if artist not in lists:
            lists[artist] = lookup(id=artist, country="KR", entity="song", limit=200) + lookup(id=artist, country="US", entity="song", limit=200)
        titles = {base_title(songs[key]["name"]), base_title(hit.get("trackName"))} - {""}
        years[key] = earliest(titles, own, lists[artist])
        print(f"{key} {songs[key]['name'][:24]} / {songs[key]['artist'][:14]}: {own} -> {years[key]}", flush=True)
    missing = [k for k in songs if k not in years]
    print(f"years {len(years)} of {len(songs)}; without a year: {[songs[k]['name'] for k in missing]}")
    print("seed:", json.dumps({i["id"]: years.get(i["id"]) for i in seed["items"] if i["category"] == "music"}))
    if args.apply:
        for item in reviewed["items"]:
            if item["id"] in years:
                item["release_year"] = years[item["id"]]
        REVIEWED_FILE.write_text(json.dumps(reviewed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
