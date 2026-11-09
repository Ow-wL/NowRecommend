import type { Category, Item } from './data';
import { FAMILIAR_LIMIT, FOOD_TRAIT_WORDS, eligibleCandidates, parseConditions, recommend, templateReasons, type Conditions, type HistoryEntry, type Preset, type Profile, type Session } from './domain';
import { recordRound, selectResult } from './history';

// A dish and a song picked together. No model is asked: the dishes come from the usual recommender, and each gets the song
// whose registered tags answer the dish's own tags through the table below, so every reason on a card can be checked.

/** Most telling trait first: nearly every dish is 따뜻함, so it comes last and only decides what nothing else did. */
const RULES: { food: string; music: string[] }[] = [
  { food: '매콤함', music: ['활기참', '높은 에너지', '록'] },
  { food: '상큼함', music: ['팝', '활기참', '중간 에너지'] },
  { food: '차가움', music: ['팝', '중간 에너지'] },
  { food: '담백함', music: ['차분함', '어쿠스틱', '낮은 에너지'] },
  { food: '고소함', music: ['재즈', '어쿠스틱', '중간 에너지'] },
  { food: '국물', music: ['발라드', '피아노', '차분함'] },
  { food: '채소', music: ['어쿠스틱', '차분함'] },
  { food: '함께', music: ['팝', '활기참'] },
  { food: '혼자', music: ['휴식', '피아노'] },
  { food: '따뜻함', music: ['발라드', '차분함'] },
];
const FOOD_WORD: Record<string, string> = { ...FOOD_TRAIT_WORDS, 함께: '함께 먹는', 혼자: '혼자 먹는' };
const SONG_WORD: Record<string, string> = { 활기참: '활기찬', '높은 에너지': '에너지 높은', 록: '록', 팝: '팝', '중간 에너지': '적당히 경쾌한', 차분함: '차분한', 어쿠스틱: '어쿠스틱', '낮은 에너지': '잔잔한', 재즈: '재즈', 발라드: '발라드', 피아노: '피아노', 휴식: '쉬기 좋은' };
const KINDS = ['연주곡', '피아노', '재즈', '어쿠스틱', '발라드', '록', '팝'];
/** The dish's first trait decides most; the next ones only break ties in its favour. */
const RANK = [3, 1.5, .75];
/** Above anything the table can add up to: what the person wrote always beats what the dish suggests. */
const TYPED_WEIGHT = 20, MOMENT_WEIGHT = 1, TASTE_WEIGHT = .25;

export type PairRequest = { raw: string; label: string; conditions: Record<Category, Conditions>;
  /** Whether the person's own words named conditions for this side, rather than the hour supplying them. */
  typed: Record<Category, boolean> };
export type PairLink = { food: string; music: string };
export type Pair = { food: Item; song: Item; links: PairLink[]; reason: string };
export type Seen = Record<Category, string[]>;
type Profiles = Record<Category, Profile>;

/** What was written decides; a side it says nothing about follows the hour, and the sentence's exclusions always hold. */
export function pairRequest(raw: string, moment: Record<Category, Preset>): PairRequest {
  const side = (c: Category) => { const parsed = parseConditions(raw, c); return { typed: parsed.tags.length > 0, conditions: { tags: parsed.tags.length ? parsed.tags : moment[c].conditions.tags, excluded: parsed.excluded } }; };
  const food = side('food'), music = side('music');
  return { raw: raw.trim(), label: raw.trim() || moment.food.name, conditions: { food: food.conditions, music: music.conditions }, typed: { food: food.typed, music: music.typed } };
}

const rulesFor = (food: Item) => RULES.filter(r => food.tags.includes(r.food)).slice(0, RANK.length);
const sessionFor = (category: Category, request: PairRequest, seen: string[]): Session => ({ category, raw: request.raw, conditions: request.conditions[category], excludedIds: [], revision: 0, seenIds: seen });
const preferredTags = (profile: Profile, catalog: Item[]) => new Set([...profile.tags, ...catalog.filter(i => profile.selected.includes(i.id)).flatMap(i => i.tags)]);

/** Why these two: only tags both items really carry are named, and a pair with no such tag says so. */
export function describePair(food: Item, song: Item, request: PairRequest): Pair {
  const links: PairLink[] = [];
  for (const rule of rulesFor(food)) {
    const music = rule.music.find(t => song.tags.includes(t) && !links.some(l => l.music === t));
    if (music) links.push({ food: rule.food, music });
  }
  const asked = request.typed.music ? request.conditions.music.tags.filter(t => song.tags.includes(t)) : [];
  const [link] = links;
  // The dish by name and the song by kind, so that two pairs built on the same traits still read differently.
  const kind = (used?: string) => { const t = KINDS.find(k => song.tags.includes(k) && k !== used); return t === '연주곡' ? t : t ? `${t} 곡` : '곡'; };
  const reason = asked.length ? `이번 조건 ${asked.slice(0, 2).join(' · ')}에 맞춘 ${kind()}이에요.`
    : link ? `${FOOD_WORD[link.food]} ${food.name}에 ${SONG_WORD[link.music]} ${kind(link.music)}을 맞췄어요.`
    : `이 메뉴와 맞물리는 특징은 적은 ${kind()}이에요.`;
  return { food, song, links: links.slice(0, 2), reason };
}

function songScore(food: Item, song: Item, request: PairRequest, preferred: Set<string>) {
  const fit = rulesFor(food).reduce((sum, rule, n) => sum + RANK[n] * rule.music.filter(t => song.tags.includes(t)).length, 0);
  const asked = request.conditions.music.tags.filter(t => song.tags.includes(t)).length * (request.typed.music ? TYPED_WEIGHT : MOMENT_WEIGHT);
  return fit + asked + TASTE_WEIGHT * song.tags.filter(t => preferred.has(t)).length;
}

/** The best song for this dish among those not used in this set: a new artist each time, unseen songs before repeats. */
function pickSong(food: Item, request: PairRequest, profile: Profile, catalog: Item[], taken: Item[], seen: string[]): Item | undefined {
  const preferred = preferredTags(profile, catalog);
  const familiar = taken.filter(t => profile.selected.includes(t.id)).length;
  const pool = eligibleCandidates(sessionFor('music', request, seen), profile, catalog).filter(s => !taken.some(t => t.id === s.id || t.subtitle === s.subtitle) && (familiar < FAMILIAR_LIMIT || !profile.selected.includes(s.id)));
  const fresh = (s: Item) => seen.includes(s.id) ? 1 : 0;
  return pool.sort((a, b) => fresh(a) - fresh(b) || songScore(food, b, request, preferred) - songScore(food, a, request, preferred) || a.id.localeCompare(b.id))[0];
}

export function recommendPairs(request: PairRequest, profiles: Profiles, catalog: Item[], seen: Seen = { food: [], music: [] }): Pair[] {
  const pairs: Pair[] = [];
  for (const { item: food } of recommend(sessionFor('food', request, seen.food), profiles.food, catalog)) {
    const song = pickSong(food, request, profiles.music, catalog, pairs.map(p => p.song), seen.music);
    if (song) pairs.push(describePair(food, song, request));
  }
  return pairs;
}

/** Another song for one dish; null once every song for it has been shown. */
export function replaceSong(pair: Pair, pairs: Pair[], request: PairRequest, profiles: Profiles, catalog: Item[], seen: Seen): Pair | null {
  const song = pickSong(pair.food, request, profiles.music, catalog, pairs.filter(p => p !== pair).map(p => p.song), [...seen.music, pair.song.id]);
  return song && song.id !== pair.song.id && !seen.music.includes(song.id) ? describePair(pair.food, song, request) : null;
}

export const withSeen = (seen: Seen, pairs: Pair[]): Seen => ({ food: [...new Set([...seen.food, ...pairs.map(p => p.food.id)])], music: [...new Set([...seen.music, ...pairs.map(p => p.song.id)])] });

/** The choice goes into the history as one recommendation per side, so the record, the stats and the reviews need no new kind of entry. */
export function recordPair(history: HistoryEntry[], request: PairRequest, pair: Pair, profiles: Profiles, catalog: Item[], date = new Date().toISOString()): { history: HistoryEntry[]; ids: string[] } {
  let next = history; const ids: string[] = [];
  for (const [category, item] of [['food', pair.food], ['music', pair.song]] as [Category, Item][]) {
    const session: Session = { ...sessionFor(category, request, []), raw: request.label, id: crypto.randomUUID(), roundId: crypto.randomUUID() };
    const reasons = templateReasons(item, profiles[category], preferredTags(profiles[category], catalog), request.conditions[category], category);
    const result = { item, tasteReason: reasons.tasteReason, contextReason: category === 'music' ? pair.reason : reasons.contextReason };
    next = recordRound(next, session, [result], [], date).map(h => h.id === session.id ? selectResult(h, result, session.roundId!) : h);
    ids.push(session.id!);
  }
  return { history: next, ids };
}
