import type { Category, Item } from './data';
import type { Session, YearRange } from './domain';
import { POLES, STATEMENTS, TYPE_DETAILS, type Statement, type TypeDetail } from './typeContent';

// The taste type test (2026-11-03): an MBTI-style four-letter code for food and for music. Light fun, not a measurement:
// the code picks a name and a sentence for the AI to read. Since 2026-11-23 it is 24 statements per category answered on
// a 5-point agreement scale (src/typeContent.ts holds every word), six per axis, three for each side, and the result
// carries how far each axis leans (`scores`). Results and links from the sixteen two-choice questions still read.
export type Axis = { a: string; b: string; aLabel: string; bLabel: string; aWish: string; bWish: string; tags: [string | null, string | null]; aMatch: string[]; bMatch: string[] };
/** `scores`: per axis, how far the answers lean to its first side, 0–100 (50: even). `counts`: the same from the sixteen
 * two-choice questions used until 2026-11-22 (per axis, how many of its four went to the first side). Neither: a result
 * read from the registered taste, or from the eight questions before that. */
export type TasteTypeResult = { code: string; date: string; source: 'quiz' | 'taste'; counts?: number[]; scores?: number[] };
/** Questions per axis in the two-choice test (2026-11-10 to 2026-11-22), for reading its results and links. */
const PER_AXIS = 4;
export type { Statement, TypeDetail };
export const STATEMENT_COUNT = 24;
/** The answer scale, strongest agreement first. */
export const SCALE: { value: Answer; label: string }[] = [{ value: 2, label: '매우 그렇다' }, { value: 1, label: '그렇다' }, { value: 0, label: '보통이다' }, { value: -1, label: '아니다' }, { value: -2, label: '전혀 아니다' }];
export type Answer = -2 | -1 | 0 | 1 | 2;
export const statements = (category: Category): Statement[] => STATEMENTS[category];
export const poles = (category: Category) => POLES[category];
/** How far an axis must lean for a recommendation to ask for that side (within this of 50 it asks for neither). */
const DECIDED = 8;

export const AXES: Record<Category, Axis[]> = {
  food: [
    { a: 'S', b: 'M', aLabel: '자극적인 맛', bLabel: '순한 맛', aWish: '얼큰하고 자극적인 맛', bWish: '순하고 담백한 맛', tags: ['매콤함', '담백함'], aMatch: ['매콤함'], bMatch: ['담백함'] },
    { a: 'H', b: 'L', aLabel: '든든하게', bLabel: '가볍게', aWish: '배부르고 든든한 메뉴', bWish: '가볍고 산뜻한 메뉴', tags: ['고소함', '채소'], aMatch: ['고소함', '국물'], bMatch: ['채소', '상큼함', '차가움'] },
    { a: 'T', b: 'N', aLabel: '익숙한 메뉴', bLabel: '새로운 메뉴', aWish: '익숙한 메뉴', bWish: '평소 잘 안 먹어 본 새로운 메뉴', tags: [null, null], aMatch: ['한식', '분식'], bMatch: ['아시안', '양식', '일식', '중식'] },
    { a: 'A', b: 'G', aLabel: '혼자서', bLabel: '여럿이', aWish: '혼자 먹기 좋은 메뉴', bWish: '여럿이 나눠 먹기 좋은 메뉴', tags: ['혼자', '함께'], aMatch: ['혼자'], bMatch: ['함께'] },
  ],
  music: [
    { a: 'E', b: 'C', aLabel: '신나게', bLabel: '차분하게', aWish: '에너지가 넘치는 곡', bWish: '차분하고 잔잔한 곡', tags: ['활기참', '차분함'], aMatch: ['활기참', '높은 에너지'], bMatch: ['차분함', '낮은 에너지'] },
    { a: 'V', b: 'I', aLabel: '노래 중심', bLabel: '연주 중심', aWish: '목소리와 가사가 중심인 곡', bWish: '악기 연주가 중심인 곡', tags: ['보컬', '연주곡'], aMatch: ['보컬', '발라드'], bMatch: ['연주곡', '피아노', '재즈'] },
    { a: 'R', b: 'N', aLabel: '옛 노래', bLabel: '요즘 노래', aWish: '시간이 지나도 사랑받는 옛 노래', bWish: '요즘 나온 노래', tags: [null, null], aMatch: [], bMatch: [] },
    { a: 'F', b: 'B', aLabel: '집중해서 듣기', bLabel: '틀어 두기', aWish: '집중해서 듣기 좋은 곡', bWish: '무언가 하면서 틀어 두기 좋은 곡', tags: [null, null], aMatch: [], bMatch: ['과제', '산책', '운동', '휴식'] },
  ],
};

export const TYPE_NAMES: Record<Category, Record<string, string>> = {
  food: {
    SHTA: '혼밥 국밥 장인', SHTG: '얼큰한 회식 대장', SHNA: '매운맛 탐험가', SHNG: '마라 원정대장',
    SLTA: '칼칼한 한 그릇파', SLTG: '매콤한 분식 메이트', SLNA: '향신료 산책자', SLNG: '타코 파티 플래너',
    MHTA: '든든한 집밥 수호자', MHTG: '푸짐한 한상 주인장', MHNA: '담백한 미식 연구가', MHNG: '코스 요리 안내자',
    MLTA: '맑은 국물 명상가', MLTG: '소풍 도시락 담당', MLNA: '샐러드 실험가', MLNG: '브런치 모임장',
  },
  music: {
    EVRF: '떼창하는 레트로 팬', EVRB: '추억 플레이리스트 DJ', EVNF: '신곡 첫 재생러', EVNB: '운동 부스터 큐레이터',
    EIRF: '전설의 라이브 감상가', EIRB: '그루브 타는 작업자', EINF: '사운드 탐험가', EINB: '비트로 달리는 러너',
    CVRF: '가사 곱씹는 낭만파', CVRB: '밤 라디오 청취자', CVNF: '감성 신곡 수집가', CVNB: '카페 플레이리스트 주인',
    CIRF: '재즈바 단골', CIRB: '오후의 LP 애호가', CINF: '앰비언트 탐구자', CINB: '집중 모드 장인',
  },
};

/** Per axis, 0–100 toward its first side: each statement adds its answer (agreeing with a second-side statement counts
 * against the first side), and the sum is set on a scale where every answer at its strongest is 0 or 100. */
export function scoresFromAnswers(category: Category, answers: Answer[]): number[] {
  return AXES[category].map((_, n) => {
    const own = STATEMENTS[category].flatMap((s, i) => s.axis === n ? [(s.key === 'a' ? 1 : -1) * (answers[i] ?? 0)] : []);
    return Math.round(50 + 50 * own.reduce((sum, v) => sum + v, 0) / (2 * own.length));
  });
}
/** The code of the scores; an even axis (50) goes to its first side. */
export const codeFromScores = (category: Category, scores: number[]) => AXES[category].map((axis, n) => scores[n] >= 50 ? axis.a : axis.b).join('');
/** A result's lean per axis, 0–100, whichever test it came from; undefined when it has none (read from the taste). */
export function percentsOf(result: { counts?: number[]; scores?: number[] }): number[] | undefined {
  if (result.scores) return result.scores;
  return result.counts?.map(n => Math.round(n / PER_AXIS * 100));
}

/** The minimum of liked items that says anything; below it the test is the only way. */
export const MIN_ITEMS_FOR_TYPE = 3;
/** The code the registered items lean to, from their tags; an axis with no signal takes its second side only if that side has any. */
export function codeFromItems(category: Category, liked: Pick<Item, 'tags' | 'releaseYear'>[], now = new Date().getFullYear()): string | undefined {
  if (liked.length < MIN_ITEMS_FOR_TYPE) return undefined;
  return AXES[category].map(axis => {
    const count = (words: string[]) => liked.filter(i => words.some(w => i.tags.includes(w))).length;
    if (axis.a === 'R') return liked.filter(i => i.releaseYear !== undefined && i.releaseYear < now - 10).length * 2 >= liked.filter(i => i.releaseYear !== undefined).length ? axis.a : axis.b;
    return count(axis.aMatch) >= count(axis.bMatch) ? axis.a : axis.b;
  }).join('');
}

export const typeName = (category: Category, code: string) => TYPE_NAMES[category][code] || code;
export const typeProfile = (category: Category, code: string): TypeDetail | undefined => TYPE_DETAILS[category][code];
export const sides = (category: Category, code: string) => AXES[category].map((axis, n) => code[n] === axis.a ? { letter: axis.a, label: axis.aLabel, wish: axis.aWish, tag: axis.tags[0] } : { letter: axis.b, label: axis.bLabel, wish: axis.bWish, tag: axis.tags[1] });

/** How far each axis leans, for the bars (`percents` from percentsOf). Empty without them: a result read from tags has no proportion to show. */
export function axisLeans(category: Category, percents?: number[]) {
  if (!percents) return [];
  return AXES[category].map((axis, n) => ({ aLabel: axis.aLabel, bLabel: axis.bLabel, aPercent: percents[n] }));
}

/** A request in the type's words: the sentence is for the AI, the tags and years are the checkable part. An axis that
 * hardly leans (`percents` from percentsOf, within DECIDED of even) asks for neither side. */
export function requestForType(category: Category, code: string, now = new Date().getFullYear(), percents?: number[]): Pick<Session, 'raw' | 'conditions' | 'years'> {
  const decided = (n: number) => !percents || Math.abs(percents[n] - 50) >= DECIDED;
  const parts = sides(category, code).filter((_, n) => decided(n));
  const years: YearRange | undefined = category !== 'music' || !decided(2) ? undefined : code[2] === 'R' ? { to: now - 10 } : { from: now - 2 };
  return { raw: parts.map(p => p.wish).join(', ').slice(0, 280) + ' 위주로 추천해줘', conditions: { tags: parts.flatMap(p => p.tag ? [p.tag] : []), excluded: [] }, ...(years ? { years } : {}) };
}

// Who gets along: the same taste on the first two axes with the other two filling each other in, and the reverse.
const flip = (category: Category, code: string, axes: number[]) => code.split('').map((letter, n) => { const axis = AXES[category][n]; return axes.includes(n) ? (letter === axis.a ? axis.b : axis.a) : letter; }).join('');
const WHY: Record<Category, { best: string; worst: string }> = {
  food: { best: '입맛은 같은데 메뉴 고르는 방식은 서로 채워 줘요.', worst: '먹는 방식은 통하는데 메뉴판 앞에서 늘 갈려요.' },
  music: { best: '듣고 싶은 분위기는 같은데 듣는 방식은 서로 넓혀 줘요.', worst: '듣는 습관은 비슷한데 플레이리스트 주도권을 두고 다퉈요.' },
};
export function relatedTypes(category: Category, code: string) {
  const best = flip(category, code, [2, 3]), worst = flip(category, code, [0, 1]);
  return { best: { code: best, name: typeName(category, best), why: WHY[category].best }, worst: { code: worst, name: typeName(category, worst), why: WHY[category].worst } };
}

// A link carries only the codes, how far each axis leans and the name the person set: "?t=f-SHTA-72405561.m-CIRF-…&n=이름#/type"
// (two digits per axis, 0–99). Links from the two-choice test carry four single digits ("f-SHTA-3432") and still read.
export type SharedType = { code: string; counts?: number[]; scores?: number[] };
export type SharedTypes = { name: string; types: Partial<Record<Category, SharedType>> };
const NAME_LIMIT = 12;
const LETTER: Record<string, Category> = { f: 'food', m: 'music' };
const digits = (r: Pick<TasteTypeResult, 'counts' | 'scores'>) => r.scores ? `-${r.scores.map(s => String(Math.min(99, Math.max(0, s))).padStart(2, '0')).join('')}` : r.counts ? `-${r.counts.join('')}` : '';
export function shareSearch(results: Partial<Record<Category, Pick<TasteTypeResult, 'code' | 'counts' | 'scores'>>>, name = ''): string {
  const part = (key: string, c: Category) => { const r = results[c]; return r ? [`${key}-${r.code}${digits(r)}`] : []; };
  const t = [...part('f', 'food'), ...part('m', 'music')].join('.');
  const label = name.trim().slice(0, NAME_LIMIT);
  return `?t=${t}${label ? `&n=${encodeURIComponent(label)}` : ''}`;
}
/** Null unless the link is exactly what shareSearch writes: anything else in the address is not a result to show. */
export function parseShared(search: string): SharedTypes | null {
  const params = new URLSearchParams(search), t = params.get('t');
  if (!t) return null;
  const types: SharedTypes['types'] = {};
  for (const part of t.split('.')) {
    const [key, code, digits] = part.split('-'), category = LETTER[key];
    if (!category || !TYPE_NAMES[category][code] || types[category]) return null;
    let counts: number[] | undefined, scores: number[] | undefined;
    if (digits !== undefined && digits.length === 4) {
      counts = digits.split('').map(Number);
      const agrees = counts.every((n, i) => Number.isInteger(n) && n >= 0 && n <= PER_AXIS && (n === PER_AXIS / 2 || (n > PER_AXIS / 2) === (code[i] === AXES[category][i].a)));
      if (!agrees) return null;
    } else if (digits !== undefined && /^\d{8}$/.test(digits)) {
      scores = digits.match(/\d\d/g)!.map(Number);
      if (!scores.every((s, i) => (s >= 50) === (code[i] === AXES[category][i].a))) return null;
    } else if (digits !== undefined) return null;
    types[category] = { code, ...(counts ? { counts } : {}), ...(scores ? { scores } : {}) };
  }
  // eslint-disable-next-line no-control-regex
  return { name: (params.get('n') || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NAME_LIMIT), types };
}

const share = (category: Category, t: SharedType) => { const p = percentsOf(t); return AXES[category].map((axis, n) => p ? p[n] / 100 : t.code[n] === axis.a ? 1 : 0); };
/** For fun: the floor keeps two friends from reading 0%. Near answers score near each other; a shared letter is what the lists name. */
export function compareTypes(category: Category, mine: SharedType, theirs: SharedType) {
  const a = share(category, mine), b = share(category, theirs);
  const closeness = 1 - a.reduce((sum, v, n) => sum + Math.abs(v - b[n]), 0) / a.length;
  const percent = Math.round(45 + 55 * closeness);
  const mySides = sides(category, mine.code), theirSides = sides(category, theirs.code);
  return { percent, verdict: percent >= 85 ? '찰떡이에요' : percent >= 65 ? '잘 맞는 편이에요' : '티격태격하는 사이예요',
    same: mySides.flatMap((s, n) => s.letter === theirSides[n].letter ? [s.label] : []),
    different: mySides.flatMap((s, n) => s.letter !== theirSides[n].letter ? [{ mine: s.label, theirs: theirSides[n].label }] : []) };
}
/** Something for the two of them: items carrying what both lean to. */
export function togetherItems(category: Category, mine: SharedType, theirs: SharedType, items: Item[], count = 3): Item[] {
  const wanted = AXES[category].flatMap((axis, n) => mine.code[n] !== theirs.code[n] ? [] : mine.code[n] === axis.a ? axis.aMatch : axis.bMatch);
  const score = (i: Item) => i.tags.filter(t => wanted.includes(t)).length;
  return items.filter(i => i.category === category && score(i) > 0).sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id)).slice(0, count);
}
