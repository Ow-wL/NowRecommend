"""Side-by-side check of retrieval_only vs AI rerank on fixed situations: python -m app.cli.compare [--pace 13] [--only 달리기]

Uses the real embedding and generation APIs (one generate call per case). τ=0 so retrieval is repeatable.
--pace waits between cases so the free tier (5 generate requests/min) is not exhausted mid-run.
"""
import argparse
import time

from ..config import get_settings
from ..db import get_sessionmaker
from ..recommend import recommend
from ..routes.recommend import get_query_embedder, get_rerank_model
from ..schemas import RecommendRequest

SPICY_MEAT = ["f04", "f08", "f11", "f13", "f16"]  # 김치찌개·마라탕·떡볶이·치킨·스테이크
CASES = [
    ("food", "더운 날 시원하게 점심", ["점심", "차가움"], ["밀"], SPICY_MEAT),
    ("food", "혼자 먹을 담백한 저녁", ["혼자", "저녁", "담백함"], [], SPICY_MEAT),
    ("food", "비 오는 날 얼큰한 국물", ["국물", "매콤함"], [], SPICY_MEAT),
    ("food", "가볍게 먹을 점심", ["점심", "담백함"], [], SPICY_MEAT),
    ("food", "친구랑 저녁에 같이 먹을 거", ["함께", "저녁"], ["매콤함"], ["f01", "f02", "f07", "f09", "f12"]),
    ("food", "속이 안 좋아서 부담 없는 걸로", ["담백함"], ["매콤함"], SPICY_MEAT),
    ("music", "과제하면서 들을 잔잔한 피아노", ["과제", "차분함", "피아노"], [], ["m01", "m03", "m05", "m13", "m15"]),
    ("music", "신나게 달리기", ["운동", "활기참"], [], ["m06", "m07", "m10", "m11", "m12"]),
    ("music", "비 오는 밤 혼자 듣기 좋은 노래", [], [], ["m02", "m03", "m04", "m09", "m13"]),
    ("music", "집중해야 하는데 가사 없는 걸로", ["과제"], ["보컬"], ["m01", "m02", "m13", "m14", "m15"]),
]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pace", type=float, default=13.0, help="seconds between cases")
    parser.add_argument("--only", default="", help="run only cases whose sentence contains this text")
    args = parser.parse_args()
    cases = [c for c in CASES if args.only in c[1]]
    embed, model = get_query_embedder(), get_rerank_model()
    if model is None:
        raise SystemExit("rerank model is not configured (GEMINI_API_KEY / RERANK_ENABLED)")
    print(f"model: {get_settings().llm_model}")
    with get_sessionmaker()() as session:
        for index, (category, raw, tags, excluded, liked) in enumerate(cases):
            if index:
                time.sleep(args.pace)
            request = RecommendRequest(category=category, raw=raw, tau=0,
                                       conditions={"tags": tags, "excluded": excluded},
                                       profile={"selected": liked})
            base = recommend(session, request, embed, rerank_model=None)
            started = time.perf_counter()
            ai = recommend(session, request, embed, rerank_model=model)
            ms = (time.perf_counter() - started) * 1000
            names = lambda r: " · ".join(x["item"]["name"] for x in r["results"])  # noqa: E731
            print(f"\n[{category}] {raw}  (조건 {tags}, 제외 {excluded})")
            print(f"  유사도만 : {names(base)}")
            print(f"  AI 재순위: {names(ai)}  [{ai['meta']['mode']}, {ms:.0f}ms]")
            for r in ai["results"]:
                print(f"    - {r['item']['name']}: {r['tasteReason']} / {r['contextReason']}")


if __name__ == "__main__":
    main()
