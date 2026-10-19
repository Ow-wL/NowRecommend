"""Port of parseConditions/parseAmount in src/domain.ts, plus the text spans each rule matched.

Both implementations are checked against shared/parse-cases.json; change them together.
`\\d` is written as [0-9] because Python's \\d also matches non-ASCII digits and JS's does not.
"""
import re
from dataclasses import dataclass, field

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
NOT_SPICY = r"안\s*매운|맵지\s*않|매운.{0,5}(제외|빼|싫|피하|말고)"
NO_VOCALS = r"보컬.?없|가사.?없|보컬.{0,5}(제외|싫)"
INGREDIENTS = ["소고기", "돼지고기", "닭고기", "생선", "밀", "땅콩", "유제품", "버섯", "달걀", "콩"]
AMOUNT = re.compile(r"(?<![가-힣0-9-])((?:(?:[0-9,]+|[일이삼사오육칠팔구십]+)\s*)?(?:만|천)(?:\s*(?:[0-9]+|[일이삼사오육칠팔구십]+)?\s*천)?(?:\s*[0-9]+)?|[0-9,]+)\s*원")
DIGITS = {"일": 1, "이": 2, "삼": 3, "사": 4, "오": 5, "육": 6, "칠": 7, "팔": 8, "구": 9}


@dataclass
class RuleParse:
    tags: list[str] = field(default_factory=list)
    excluded: list[str] = field(default_factory=list)
    max_price: int | None = None
    spans: list[tuple[int, int]] = field(default_factory=list)

    def conditions(self) -> dict:
        return {"tags": list(self.tags), "excluded": list(self.excluded), "maxPrice": self.max_price}


def _cover(result: RuleParse, pattern: str, text: str) -> bool:
    spans = [m.span() for m in re.finditer(pattern, text) if m.end() > m.start()]
    result.spans += spans
    return bool(spans)


def parse_rules(text: str, category: str) -> RuleParse:
    result = RuleParse()
    for pattern, value in FOOD_RULES if category == "food" else MUSIC_RULES:
        if _cover(result, pattern, text):
            result.tags.append(value)
    if category == "food":
        if _cover(result, NOT_SPICY, text):
            result.excluded.append("매콤함")
            result.tags = [t for t in result.tags if t != "매콤함"]
        for ingredient in INGREDIENTS:
            if _cover(result, rf"(?<![가-힣]){ingredient}.{{0,6}}(제외|빼|피하|싫|없이|알레르기)", text):
                result.excluded.append(ingredient)
        if match := AMOUNT.search(text):
            result.max_price = _amount(match.group(1))
            result.spans.append(match.span())
    else:
        if _cover(result, NO_VOCALS, text):
            result.excluded.append("보컬")
        # Music has no budget; the amount is understood (and ignored), so it must not trigger the LLM.
        if match := AMOUNT.search(text):
            result.spans.append(match.span())
    return result


def _small_number(value: str) -> int:
    if re.fullmatch(r"[0-9]+", value):
        return int(value)
    if "십" in value:
        parts = value.split("십")
        return (DIGITS.get(parts[0]) or 1) * 10 + (DIGITS.get(parts[1]) or 0)
    return DIGITS.get(value) or 1


def _amount(raw: str) -> int | None:
    source = re.sub(r"[\s,]", "", raw)
    amount = 0
    for unit, multiplier in (("만", 10000), ("천", 1000)):
        if unit in source:
            parts = source.split(unit)
            amount += _small_number(parts[0]) * multiplier
            source = parts[1]
    amount += _small_number(source) if source else 0
    return amount if 100 <= amount <= 1_000_000 else None
