"""Decides whether a sentence still has meaning the rule parser did not capture.

Only then is the LLM called (the free tier allows ~20 generate requests a day). Words the rules
matched are removed; what remains is stripped of common particles/endings and checked against
words that carry no condition ("먹고 싶어", "추천해줘", "이하"). Anything left is "uncovered".
"""
import re

# Longest first so "으로" is stripped before "로".
ENDINGS = sorted(["으로", "에서", "이랑", "하고", "처럼", "까지", "부터", "이나", "에게", "한테", "이요", "이에요",
                  "이", "가", "을", "를", "은", "는", "에", "로", "도", "만", "의", "랑", "와", "과", "요"], key=len, reverse=True)
NEUTRAL = {
    "먹을", "먹고", "먹기", "먹는", "먹을래", "먹으면", "싶어", "싶다", "싶은", "싶어요", "원해", "원해요", "있어", "있어요", "있는",
    "추천", "추천해", "추천해줘", "추천해주세요", "추천해줄래", "해줘", "주세요", "알려줘", "골라줘", "부탁해",
    "오늘", "지금", "이번", "그냥", "뭔가", "아무거나", "아무", "무엇", "음식", "메뉴", "한끼", "식사", "끼니",
    "음악", "노래", "곡", "플레이리스트", "듣고", "들을", "듣기", "듣는", "들으면서", "들을만한", "하면서", "하는", "할때",
    "이하", "이내", "미만", "정도", "제외", "빼고", "말고", "없이", "싫어", "좋은", "같은", "위한", "어울리는", "느낌",
    "하게", "하고", "해서",  # leftovers of a matched stem: "담백|하게", "시원|하게"
}
WORD = re.compile(r"[가-힣A-Za-z0-9]+")


def strip_ending(word: str) -> str:
    for ending in ENDINGS:
        if word.endswith(ending) and len(word) > len(ending):
            return word[: -len(ending)]
    return word


def uncovered_words(text: str, spans: list[tuple[int, int]]) -> list[str]:
    """Words (as written) that the rules did not explain. Empty → the rule result is complete."""
    masked = list(text)
    for start, end in spans:
        masked[start:end] = " " * (end - start)
    remaining = []
    for match in WORD.finditer("".join(masked)):
        word = match.group()
        core = strip_ending(word)
        if len(core) < 2 or word in NEUTRAL or core in NEUTRAL or core.isdigit():
            continue
        remaining.append(text[match.start():match.end()])
    return list(dict.fromkeys(remaining))
