"""Port of parseConditions/unsupportedConditions in src/domain.ts, plus the text spans each rule matched.

Both implementations are checked against shared/parse-cases.json; change them together.
`\\d` is written as [0-9] because Python's \\d also matches non-ASCII digits and JS's does not.
Price, delivery and nearby-place phrases are recognised only to be reported as unsupported (2026-10-27): their spans
count as understood, so they never reach the LLM, and situation_text() removes them before ranking.
"""
import re
from dataclasses import dataclass, field
from functools import lru_cache

from ..vocab import CategoryVocab, get_vocab

FOOD_RULES = [
    (r"혼자|혼밥", "혼자"), (r"함께|친구|둘이", "함께"), (r"저녁", "저녁"), (r"점심", "점심"),
    (r"담백|순한|부담.?없", "담백함"), (r"매콤|매운|칼칼|얼큰", "매콤함"), (r"고소", "고소함"),
    (r"따뜻|따끈", "따뜻함"), (r"시원|차가운", "차가움"), (r"국물", "국물"), (r"채소|야채", "채소"),
]
MUSIC_RULES = [
    (r"과제|공부|집중|작업", "과제"), (r"휴식|쉬|잠|편안", "휴식"), (r"산책|걷", "산책"), (r"운동|달리|러닝", "운동"),
    (r"잔잔|차분|조용", "차분함"), (r"활기|신나|밝은", "활기참"), (r"적당히|적당한", "중간 에너지"),
    (r"연주곡|보컬.?없|가사.?없", "연주곡"), (r"재즈", "재즈"), (r"피아노", "피아노"), (r"어쿠스틱", "어쿠스틱"),
]
# "프리" is for "글루텐 프리"; "프리미엄" must not exclude the beef in "소고기 프리미엄 스테이크".
EXCLUDE = r"제외|빼|피하|싫|없[이는게음고]|말고|못\s*먹|안\s*먹|알레르기|알러지|불내증|금지|안\s*들어|안\s*돼|프리(?!미엄)"
NOT_SPICY = rf"안\s*매운|맵지\s*않|매운.{{0,5}}({EXCLUDE})"
NO_VOCALS = r"보컬.?없|가사.?없|보컬.{0,5}(제외|싫)"
# Items joined by spaces, commas or particles: "고기 생선 달걀 다 빼줘", "소고기와 돼지고기는 제외".
JOINER = r"[\s,]*(?:이랑|하고|이나|과|와|랑|및|나|도)?[\s,]*"
# Amounts: 8천원, 1만 5천원, 15,000원, 만원.
AMOUNT = r"(?<![가-힣0-9-])(?:(?:(?:[0-9,]+|[일이삼사오육칠팔구십]+)\s*)?(?:만|천)(?:\s*(?:[0-9]+|[일이삼사오육칠팔구십]+)?\s*천)?(?:\s*[0-9]+)?|[0-9,]+)\s*원"
UNSUPPORTED_PATTERNS = [
    ("price", re.compile(rf"(?:{AMOUNT})(?:\s*(?:이하|이내|미만|아래|안쪽|정도|짜리|대|선|내외|까지))?|저렴\S{{0,2}}|가성비|값싼|싸게|싸고|싼\s*(?:걸|거|것|메뉴)|비싸지\s*않\S?|비싼|(?:가격|예산|금액)대?")),
    ("delivery", re.compile(r"배달(?:\s*(?:가능한|가능하고|가능|되는|되고|되면))?|배송|포장(?!마차)(?:\s*(?:가능한|가능|되는))?|테이크\s*아웃|딜리버리|시켜\s*먹\S{0,2}")),
    ("place", re.compile(r"근처|주변|동네|가까운(?:\s*(?:곳|데|식당|가게))?|영업\s*중\S{0,2}")),
]
MONEY = re.compile(AMOUNT)
# negatedPhrases in src/domain.ts: particles a noun may carry, the ones that join a list, verb/adjective forms
# (라면·냉면 are nouns), and the modifiers whose preceding noun a negated phrase is about ("국물 있는 건").
PARTICLES = ["이랑", "하고", "이나", "은", "는", "이", "가", "을", "를", "도", "만", "랑", "와", "과", "나"]
LIST_JOINER = re.compile(r"(?:이랑|하고|랑|와|과|및)$")
NOT_A_NOUN = re.compile(r"(?:으면|하면|되면|가면|오면|이면|다면|서|게|니|며|던|한|운|할|된|을|는|은|싶은|있는|하는)$")
HOLDS = re.compile(r"(?:있는|들어간|들어있는|많은|같은|든|섞인|올라간|넣은|뿌린)$")
CLAUSE_MARKS = (".", "!", "?", ";", "·", "\n")


@dataclass
class RuleParse:
    tags: list[str] = field(default_factory=list)
    excluded: list[str] = field(default_factory=list)
    unsupported: list[dict] = field(default_factory=list)  # {"kind": price|delivery|place|ingredient|trait|exclusion, "text": ...}
    spans: list[tuple[int, int]] = field(default_factory=list)
    unsupported_spans: list[tuple[int, int]] = field(default_factory=list)
    not_wanted: set[str] = field(default_factory=set)  # tags a negated phrase asked to leave out

    def conditions(self) -> dict:
        return {"tags": list(self.tags), "excluded": list(self.excluded)}


def _cover(result: RuleParse, pattern: str, text: str) -> bool:
    spans = [m.span() for m in re.finditer(pattern, text) if m.end() > m.start()]
    result.spans += spans
    return bool(spans)


@lru_cache
def _exclusion_patterns(category: str) -> tuple[re.Pattern, re.Pattern, dict[str, list[str]]]:
    vocab: CategoryVocab = get_vocab().for_category(category)
    words = {**{value: [value] for value in vocab.exclusions}, **vocab.exclusionAliases}
    term = "|".join(re.escape(w) for w in sorted([*words, *vocab.unsupportedExclusions], key=len, reverse=True))
    listed = re.compile(rf"(?<![가-힣])((?:{term})(?:{JOINER}(?:{term}))*).{{0,6}}?(?:{EXCLUDE})")
    return listed, re.compile(term), words


def _listed_exclusions(result: RuleParse, text: str, category: str) -> set[str]:
    """Every listed word before an exclusion trigger, mapped to vocabulary values via exclusionAliases.
    Words the catalog cannot check ("새우") become unsupported instead of being mapped to something narrower."""
    listed, term, words = _exclusion_patterns(category)
    found: set[str] = set()
    unsupported: list[str] = []
    for match in listed.finditer(text):
        result.spans.append(match.span())
        for word in term.findall(match.group(1)):
            if word in words:
                found.update(words[word])
            elif word not in unsupported:
                unsupported.append(word)
    result.unsupported += [{"kind": "ingredient", "text": f"{w} 제외"} for w in unsupported]
    return found


def _letters(token: str) -> str:
    return re.sub(r"[^가-힣A-Za-z]", "", token)


def _noun(token: str) -> str | None:
    vocab = get_vocab()
    word = _letters(token)
    # The first particle that leaves a word of two or more letters, or a listed short word: "오이랑" → 오이 ("오이"
    # stays), "깨는" → 깨, "파는" → 파.
    particle = next((p for p in PARTICLES if word.endswith(p) and (len(word) - len(p) >= 2 or word[: -len(p)] in vocab.exclusionShortWords)), None)
    if particle:
        word = word[: -len(particle)]
    if word in vocab.exclusionShortWords:
        return word
    return None if len(word) < 2 or word in vocab.exclusionStopWords or NOT_A_NOUN.search(word) else word


def _is_head(token: str) -> bool:
    word = _letters(token)
    return any(word == h or word.startswith(h) and word[len(h):] in (*PARTICLES, "로", "으로") for h in get_vocab().exclusionHeadNouns)


def _is_modifier(token: str) -> bool:
    """Adnominal forms end in ㄴ, ㄹ or 는: "고소한", "매운", "먹을", "있는"."""
    word = _letters(token)
    if not word or word in get_vocab().exclusionStopWords:
        return False
    code = ord(word[-1]) - 0xAC00
    return word.endswith("는") or 0 <= code < 11172 and code % 28 in (4, 8)


@dataclass
class Negated:
    start: int
    end: int
    phrase: str
    nouns: list[str]
    head: bool


def negated_phrases(text: str) -> list[Negated]:
    """The phrase each exclusion trigger negates: a head-noun phrase ("국물 있는 건 빼줘": all of it is negated) or a
    list of nouns ("오이랑 고수 빼줘"; across commas only when every part is one word: "점심, 고수, 참깨 빼줘")."""
    found: list[Negated] = []
    for match in re.finditer(EXCLUDE, text):
        before = text[: match.start()]
        clause_start = max(before.rfind(c) for c in CLAUSE_MARKS) + 1
        tokens: list[tuple[str, int, int, int]] = []  # text, start, end, comma segment
        segment = 0
        for t in re.finditer(r"[^\s,]+|,", before[clause_start:]):
            if t.group() == ",":
                segment += 1
            else:
                tokens.append((t.group(), clause_start + t.start(), clause_start + t.end(), segment))
        taken: list[tuple[str, int, int, int]] = []
        nouns: list[str] = []
        index = len(tokens) - 1

        def take_nouns() -> None:
            nonlocal index
            first = True
            while index >= 0:
                token = tokens[index]
                if not first and taken:
                    following = taken[0]
                    if token[3] == following[3]:
                        if not LIST_JOINER.search(_letters(token[0])):
                            break
                    elif token[3] != following[3] - 1 or sum(t[3] == token[3] for t in tokens) != 1:
                        break
                word = _noun(token[0])
                if not word:
                    break
                nouns.insert(0, word)
                taken.insert(0, token)
                index -= 1
                first = False

        head = index >= 0 and _is_head(tokens[index][0])
        if head:
            taken.insert(0, tokens[index])
            index -= 1
            while index >= 0 and tokens[index][3] == taken[0][3] and _is_modifier(tokens[index][0]):
                holds = bool(HOLDS.search(_letters(tokens[index][0])))
                taken.insert(0, tokens[index])
                index -= 1
                if holds:
                    take_nouns()
                    break
        else:
            take_nouns()
        if taken:
            found.append(Negated(taken[0][1], taken[-1][2], text[taken[0][1]:taken[-1][2]], nouns, head))
    return found


@dataclass
class Negations:
    excluded: set[str]
    unsupported: list[dict]
    masked: str
    not_wanted: set[str]
    spans: list[tuple[int, int]]


def read_negations(text: str, category: str) -> Negations:
    """What the negated phrases ask to leave out: exclusions to apply, ones that cannot be applied (reported, never
    turned into a wanted tag), the text with head-noun phrases blanked for the tag rules, and tags never to want."""
    vocab = get_vocab()
    category_vocab = vocab.for_category(category)
    rules = FOOD_RULES if category == "food" else MUSIC_RULES
    words = {**{v: [v] for v in category_vocab.exclusions}, **category_vocab.exclusionAliases}
    labels = [*category_vocab.conditionTags, *category_vocab.extraTags]
    result = Negations(set(), [], text, set(), [])

    def report(kind: str, label: str) -> None:
        entry = {"kind": kind, "text": f"{label} 제외"}
        if entry not in result.unsupported:
            result.unsupported.append(entry)

    def leave_out(tag: str) -> None:
        result.not_wanted.add(tag)
        if tag in category_vocab.exclusions:
            result.excluded.add(tag)
        else:
            report("trait", tag)

    for negated in negated_phrases(text):
        result.spans.append((negated.start, negated.end))
        if negated.head:
            result.masked = result.masked[: negated.start] + " " * (negated.end - negated.start) + result.masked[negated.end:]
            tags = [tag for pattern, tag in rules if re.search(pattern, negated.phrase)]
            for tag in tags:
                leave_out(tag)
            # "기름진 거 빼줘": nothing the app can check, but the request must not disappear either. Phrases with a known
            # word ("시끄러운 노래 싫어") are handled by _listed_exclusions; idioms ("맛없는 거") ask for nothing.
            known = any(re.search(rf"(?<![가-힣]){re.escape(w)}", negated.phrase) for w in words)
            idiom = all(any(_letters(t).startswith(w) for w in vocab.exclusionStopWords) for t in negated.phrase.split()[:-1])
            if not tags and not negated.nouns and not known and not idiom:
                report("trait", negated.phrase)
        for word in negated.nouns:
            short = vocab.exclusionShortWords.get(word)
            tag = word if word in labels else next((t for pattern, t in rules if re.search(pattern, word)), None)
            if word in words:
                result.excluded.update(words[word])
            elif short:
                result.excluded.update(short)
            elif tag:
                leave_out(tag)
            else:
                report("ingredient" if category == "food" else "exclusion", word)
    return result


def parse_rules(text: str, category: str) -> RuleParse:
    result = RuleParse()
    # What a sentence asks to leave out is never read as wanted ("국물 있는 건 빼줘", "채소 빼고"), even when it cannot
    # be excluded; the negated phrases count as understood, so they never reach the LLM.
    negations = read_negations(text, category)
    # The trigger words ("빼줘", "말고") are understood too, so a fully read request does not go to the model.
    result.spans += negations.spans + [m.span() for m in re.finditer(EXCLUDE, text)]
    result.not_wanted = negations.not_wanted
    for pattern, value in FOOD_RULES if category == "food" else MUSIC_RULES:
        _cover(result, pattern, text)
        if re.search(pattern, negations.masked) and value not in negations.not_wanted:
            result.tags.append(value)
    if category == "food":
        for kind, pattern in UNSUPPORTED_PATTERNS:
            for match in pattern.finditer(text):
                result.spans.append(match.span())
                result.unsupported_spans.append(match.span())
                entry = {"kind": kind, "text": match.group().strip()}
                if entry not in result.unsupported:
                    result.unsupported.append(entry)
    excluded = _listed_exclusions(result, text, category) | negations.excluded
    # "비건이라서 …": a diet names its groups without any trigger word (dietExclusions, also in src/domain.ts).
    for word, values in get_vocab().for_category(category).dietExclusions.items():
        if _cover(result, rf"(?<![가-힣]){re.escape(word)}", text):
            excluded.update(values)
    if category == "food":
        if _cover(result, NOT_SPICY, text):
            excluded.add("매콤함")
    else:
        if _cover(result, NO_VOCALS, text):
            excluded.add("보컬")
        # Music has no price either; an amount is understood (and ignored), so it must not trigger the LLM.
        for match in MONEY.finditer(text):
            result.spans.append(match.span())
            result.unsupported_spans.append(match.span())
    # Like "매운 건 빼고": an excluded value is never also a wanted tag ("피아노 말고").
    result.excluded = [v for v in get_vocab().for_category(category).exclusions if v in excluded]
    result.tags = [t for t in result.tags if t not in excluded]
    for entry in negations.unsupported:
        if entry not in result.unsupported:
            result.unsupported.append(entry)
    # Same order as the frontend: price, delivery, place, then exclusions it cannot apply, as they appear.
    order = {"price": 0, "delivery": 1, "place": 2, "ingredient": 3, "trait": 3, "exclusion": 3}
    result.unsupported.sort(key=lambda u: order[u["kind"]])
    return result


def situation_text(text: str, category: str) -> str:
    """The sentence without the phrases the app does not support, so "만원 이하" or "배달" cannot steer the sentence
    embedding or the AI rerank toward guessed prices or delivery."""
    spans = parse_rules(text, category).unsupported_spans
    chars = list(text)
    for start, end in spans:
        chars[start:end] = " " * (end - start)
    return " ".join("".join(chars).split())
