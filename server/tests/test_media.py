import json

from app.catalog import REVIEWED_FILE, SEED_FILE, load_seed
from app.cli.media import MEDIA_FILE, variant_of


def test_listen_links_play_the_song_itself():
    # Live check 2026-10-27: "듣기" opened "Permission to Dance (Live)" and instrumental versions of vocal songs.
    media = json.loads(MEDIA_FILE.read_text(encoding="utf-8"))
    songs = [i for i in load_seed(SEED_FILE) + load_seed(REVIEWED_FILE) if i["category"] == "music"]
    linked = [(s, media[s["id"]]) for s in songs if media.get(s["id"], {}).get("link")]
    assert len(linked) > 200
    assert [s["id"] for s, entry in linked if variant_of(entry, s)] == []
    assert all("/song/" in entry["link"] for _, entry in linked)


def test_variant_rule():
    vocal = {"name": "가끔", "tags": ["보컬"]}
    piano = {"name": "The Path of the Wind", "tags": ["연주곡"]}
    assert variant_of({"match": "Sometimes (Instrumental) - Crush [Sometimes - Single]"}, vocal) == "instrumental"
    assert variant_of({"match": "Permission to Dance (Live) - BTS [PERMISSION TO DANCE ON STAGE (LIVE)]"}, vocal) == "live"
    assert variant_of({"match": "The Path of the Wind (Instrumental) - Joe Hisaishi [Totoro]"}, piano) is None
    assert variant_of({"match": "Through the Night - IU [Through the Night - Single]"}, vocal) is None  # album words are ignored
