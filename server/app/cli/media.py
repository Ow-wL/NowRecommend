"""Item images for the prototype design: python -m app.cli.media covers [--only m01,m02]

covers: album artwork from the iTunes Search API (US store, no key) for every reviewed song. A cover is kept only
when the title and the artist both match (Korean artists also by their store name); classical pieces match on the
title alone because the store lists the performer. Results go to src/media.json, which the frontend bundles, with
the track's own Apple Music song page as `link` (the album page as `album`, for the artwork). Songs without a confident
match are left out and the UI draws a generated cover. The API allows ~20 requests a minute, so this paces itself.

variants: removes song links whose matched track is another version of the song ("(Live)", "(Instrumental)" for a
song with vocals, remixes): "듣기" would play something else. The entry keeps its album art and the UI offers a search.
`tracks` applies the same rule. Found by the live check of 2026-10-27 ("Permission to Dance (Live)").

tracks: upgrades entries that still link to an album page (covers before 2026-10-27 cut the track id off the store
URL, so "듣기" opened the album). It looks the albums up by id and keeps a song link only when the store lists a track
whose title and artist are exactly the matched ones; otherwise the entry keeps only the album page and the UI offers a
search instead of guessing.

Food photos are curated by hand (Wikimedia Commons, with author and license) and written to the same file.
"""
import argparse
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

from ..catalog import REVIEWED_FILE, SEED_FILE, load_seed
from ..config import PROJECT_ROOT

MEDIA_FILE = PROJECT_ROOT / "src" / "media.json"
COMPOSERS = {"Frédéric Chopin", "Johann Sebastian Bach", "Ludwig van Beethoven", "Johann Pachelbel", "Wolfgang Amadeus Mozart",
             "Antonio Vivaldi", "Claude Debussy", "Maurice Ravel", "Franz Liszt", "Erik Satie"}
# Store names of artists the catalog writes in Hangul (or differently).
ALIASES = {
    "아이유": ["IU"], "성시경": ["Sung Si Kyung"], "김광석": ["Kim Kwang Seok", "Kim Kwang-seok"], "이문세": ["Lee Moon Sae", "Lee Moon-sae"],
    "유재하": ["Yoo Jae Ha"], "전람회": ["Exhibition"], "김동률": ["Kim Dong Ryul"], "폴킴": ["Paul Kim"], "잔나비": ["JANNABI"],
    "검정치마": ["The Black Skirts"], "혁오": ["HYUKOH"], "새소년": ["SE SO NEON"], "장범준": ["Jang Beom June"], "버스커 버스커": ["Busker Busker"],
    "악뮤": ["AKMU", "AKDONG MUSICIAN"], "볼빨간사춘기": ["BOL4", "Bolbbalgan4"], "멜로망스": ["MeloMance"], "백예린": ["Yerin Baek"],
    "적재": ["Jukjae"], "윤하": ["YOUNHA"], "이소라": ["Lee Sora"], "박효신": ["Park Hyo Shin"], "임재범": ["Yim Jae Beom"], "이적": ["Lee Juck"],
    "전인권": ["Jeon In Kwon"], "크러쉬": ["Crush"], "자이언티": ["Zion.T"], "에픽하이": ["Epik High"], "다비치": ["DAVICHI"], "거미": ["Gummy"],
    "태연": ["TAEYEON"], "너드커넥션": ["Nerd Connection"], "이하이": ["LEE HI"], "비투비": ["BTOB"], "정승환": ["Jung Seung Hwan"],
    "김건모": ["Kim Gun Mo"], "쿨": ["COOL"], "듀스": ["DEUX"], "조용필": ["Cho Yong Pil"], "들국화": ["Deulgukhwa"], "넬": ["NELL"],
    "자우림": ["Jaurim"], "크라잉넛": ["Crying Nut"], "실리카겔": ["Silica Gel"], "데이브레이크": ["Daybreak"], "에일리": ["Ailee"],
    "백지영": ["Baek Ji Young"], "김범수": ["Kim Bum Soo"], "지코": ["ZICO"], "싸이": ["PSY"], "청하": ["CHUNG HA"], "선미": ["SUNMI"],
    "마마무": ["MAMAMOO"], "오마이걸": ["OH MY GIRL"], "여자친구": ["GFRIEND"], "로제": ["ROSÉ"], "지수": ["JISOO"], "태양": ["TAEYANG"],
    "소녀시대": ["Girls' Generation"], "(여자)아이들": ["(G)I-DLE", "i-dle"], "이루마": ["Yiruma"], "히사이시 조": ["Joe Hisaishi"],
    "유키 구라모토": ["Yuhki Kuramoto"], "사카모토 류이치": ["Ryuichi Sakamoto"], "정재일": ["Jung Jae Il"], "YB": ["Yoon Do Hyun"],
}


# Store titles for Korean songs whose English name the store search does not surface on its own.
TITLE_ALIASES = {"에잇": "eight", "가끔": "Sometimes", "피 땀 눈물": "Blood Sweat & Tears", "나는 나비": "A Flying Butterfly"}


def norm(text: str | None) -> str:
    return re.sub(r"[\W_]+", "", (text or "").casefold())


def title_matches(want: str, got: str) -> bool:
    a, b = norm(want), norm(re.sub(r"\s*[\(\[].*?[\)\]]", "", got))  # store titles add "(feat. …)", "[Remastered]"
    core = norm(re.sub(r"\s*[\(\[].*?[\)\]]", "", want))
    return bool(core) and (a == norm(got) or core == b or (len(core) >= 4 and (b.startswith(core) or core.startswith(b) and len(b) >= 4)))


def artist_matches(want: str, got: str) -> bool:
    names = [want, *ALIASES.get(want, [])]
    return any(norm(n) and (norm(n) in norm(got)) for n in names)


def search(term: str, country: str = "US") -> list[dict]:
    url = "https://itunes.apple.com/search?" + urllib.parse.urlencode({"term": term, "country": country, "entity": "song", "limit": 10})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "nowrecommend-prototype/0.1"}), timeout=15) as r:
                return json.load(r).get("results", [])
        except urllib.error.HTTPError as exc:
            if exc.code != 429 or attempt == 3:
                raise
            time.sleep(30)  # the store asks callers to slow down
    return []


STORE_TRACK = re.compile(r"^https://music\.apple\.com/([a-z]{2})/album/([^/?]+)/(\d+)\?(?:.*&)?i=(\d+)")


def song_link(track_view_url: str) -> str | None:
    """The store's track URL is the album page with ?i=<track id>; Apple Music's song page is /song/<slug>/<track id>."""
    match = STORE_TRACK.match(track_view_url or "")
    return f"https://music.apple.com/{match[1]}/song/{match[2]}/{match[4]}" if match else None


def cover_from(hit: dict, checked: bool) -> dict | None:
    art = hit.get("artworkUrl100", "")
    if not art:
        return None
    cover = {"image": art.replace("100x100bb", "600x600bb"), "album": hit.get("trackViewUrl", "").split("?")[0],
             "source": "itunes", "match": f"{hit.get('trackName')} - {hit.get('artistName')} [{hit.get('collectionName')}]"}
    if link := song_link(hit.get("trackViewUrl", "")):
        cover["link"] = link
    return cover if checked else {**cover, "check": True}


ALBUM = re.compile(r"^https://music\.apple\.com/([a-z]{2})/album/[^/?]+/(\d+)$")


def lookup_tracks(country: str, collection_ids: list[str]) -> list[dict]:
    url = "https://itunes.apple.com/lookup?" + urllib.parse.urlencode({"id": ",".join(collection_ids), "entity": "song", "country": country, "limit": 200})
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "nowrecommend-prototype/0.1"}), timeout=20) as r:
        return [h for h in json.load(r).get("results", []) if h.get("wrapperType") == "track"]


# A version marker in the matched track title: "(Live)", "(Live Version)", "(Instrumental)", "- Remix".
VARIANT = re.compile(r"(?<![a-z])(live|instrumental|inst\.|remix|karaoke|acoustic|sped up|slowed|demo|cover)(?![a-z])", re.I)


def variant_of(entry: dict, item: dict) -> str | None:
    """The version marker of the matched track that the catalog song does not have, or None for the song itself.
    An instrumental recording is the song itself only when the catalog lists it as 연주곡."""
    track = entry.get("match", "").rsplit(" [", 1)[0].rsplit(" - ", 1)[0]
    for word in VARIANT.findall(track):
        word = word.lower()
        if word in item["name"].lower() or word.startswith("inst") and "연주곡" in item.get("tags", []):
            continue
        return word
    return None


def drop_variant_links(media: dict, songs: list[dict]) -> list[str]:
    """Song links that would play another version are removed (the album art stays). Returns the affected ids."""
    by_id = {s["id"]: s for s in songs}
    dropped = []
    for key, entry in media.items():
        if entry.get("link") and key in by_id and variant_of(entry, by_id[key]):
            entry.pop("link")
            dropped.append(key)
    return dropped


def upgrade_tracks(media: dict) -> tuple[int, int]:
    """Album links → song links where the album lists exactly the matched track. Returns (upgraded, album only)."""
    pending = {}
    for key, entry in media.items():
        album = entry.get("album") or (entry.get("link") if ALBUM.match(entry.get("link", "")) else None)
        if entry.get("source") == "itunes" and album and not (entry.get("link") or "").count("/song/"):
            pending[key] = album
    by_country: dict[str, list[str]] = {}
    for album in pending.values():
        match = ALBUM.match(album)
        by_country.setdefault(match[1], []).append(match[2])
    tracks: dict[tuple[str, str], dict] = {}
    for country, ids in by_country.items():
        ids = sorted(set(ids))
        for start in range(0, len(ids), 10):
            for hit in lookup_tracks(country, ids[start:start + 10]):
                tracks.setdefault((str(hit.get("collectionId")), f"{hit.get('trackName')} - {hit.get('artistName')}"), hit)
            time.sleep(3.2)
    upgraded = 0
    for key, album in pending.items():
        entry = media[key]
        wanted = entry.get("match", "").rsplit(" [", 1)[0]
        hit = tracks.get((ALBUM.match(album)[2], wanted))
        link = song_link(hit.get("trackViewUrl", "")) if hit else None
        entry["album"] = album
        if link:
            entry["link"] = link
            upgraded += 1
        else:
            entry.pop("link", None)
    return upgraded, len(pending) - upgraded


# Versions whose artwork is not the song's own release ("Permission to Dance On Stage - LIVE" for Dynamite).
NOT_ORIGINAL = re.compile(r"(?<![a-z])live(?![a-z])|karaoke|tribute|(?<![a-z])cover|remix|lullaby|music box|8-bit|made famous|originally performed|in the style of", re.I)


def original_first(hits: list[dict]) -> list[dict]:
    """Studio releases before live/karaoke/cover versions, then the earliest release (the original single or album)."""
    tagged = lambda h: bool(NOT_ORIGINAL.search(f"{h.get('collectionName', '')} {h.get('trackName', '')} {h.get('artistName', '')}"))  # noqa: E731
    return sorted(hits, key=lambda h: (tagged(h), h.get("releaseDate") or "9999"))


def find_cover(item: dict) -> dict | None:
    """A title and artist match is final. Stores list Korean songs under English titles ("밤편지" → "Through the
    Night"), so for a Hangul title the first hit by the right artist is kept with check=True for a person to confirm;
    the UI ignores entries that still carry it."""
    title, artist = item["name"], item["artist"]
    english = TITLE_ALIASES.get(title)
    if english:  # a known store title can be matched exactly, so it is no guess
        for hit in original_first([h for h in search(f"{ALIASES.get(artist, [artist])[0]} {english}") if artist_matches(artist, h.get("artistName", ""))
                                   and title_matches(english, h.get("trackName", ""))]):
            return cover_from(hit, True)
        time.sleep(3.2)
    terms = [f"{artist} {title}", *(f"{alias} {title}" for alias in ALIASES.get(artist, [])[:1])]
    guess = None
    for term in terms:
        hits = [h for h in search(term, "SG" if re.search("[가-힣]", title) else "US")
                if artist in COMPOSERS or artist_matches(artist, h.get("artistName", ""))]
        matched = [h for h in hits if title_matches(title, h.get("trackName", ""))]
        if matched:
            return cover_from(original_first(matched)[0], True)
        # Hangul title listed in English: keep the store's own ranking (the best text match), originals first.
        if guess is None and re.search("[가-힣]", title):
            first = next((h for h in hits if not NOT_ORIGINAL.search(f"{h.get('collectionName', '')} {h.get('trackName', '')}")), None)
            guess = cover_from(first, False) if first else None
        time.sleep(3.2)
    return guess


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    covers = commands.add_parser("covers")
    covers.add_argument("--only", default="", help="comma-separated item ids")
    covers.add_argument("--out", type=Path, default=MEDIA_FILE)
    tracks = commands.add_parser("tracks")
    tracks.add_argument("--out", type=Path, default=MEDIA_FILE)
    variants = commands.add_parser("variants")
    variants.add_argument("--out", type=Path, default=MEDIA_FILE)
    args = parser.parse_args()

    media = json.loads(args.out.read_text(encoding="utf-8")) if args.out.exists() else {}
    songs = [i for i in load_seed(SEED_FILE) + (load_seed(REVIEWED_FILE) if REVIEWED_FILE.exists() else []) if i["category"] == "music"]
    if args.command in ("tracks", "variants"):
        if args.command == "tracks":
            upgraded, album_only = upgrade_tracks(media)
            print(f"tracks: {upgraded} song links, {album_only} album only (the UI offers a search for those)")
        dropped = drop_variant_links(media, songs)
        args.out.write_text(json.dumps(dict(sorted(media.items())), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"variants: removed {len(dropped)} song links to another version: {', '.join(dropped) or '-'}")
        return
    only = {s for s in args.only.split(",") if s}
    todo = [s for s in songs if not only or s["id"] in only]
    missing = []
    for index, item in enumerate(todo):
        cover = find_cover(item)
        if cover:
            media[item["id"]] = cover
        else:
            media.pop(item["id"], None)
            missing.append(f"{item['name']} - {item['artist']}")
        mark = "-" if not cover else "?" if cover.get("check") else "O"
        print(f"{index + 1:3} {mark} {item['id']} {item['name']} - {item['artist']}" + (f"  ← {cover['match']}" if cover else ""), flush=True)
        args.out.write_text(json.dumps(dict(sorted(media.items())), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        time.sleep(3.2)
    checks = sum(bool(media.get(i["id"], {}).get("check")) for i in todo)
    print(f"covers: {len(todo) - len(missing)} found ({checks} to check by hand), {len(missing)} left to generated covers")


if __name__ == "__main__":
    main()
