import vocab from '../shared/vocab.json' with { type: 'json' };
import type { Category, Item } from './data';
import type { HistoryEntry, Profile, Session } from './domain';

// What the record says about the next recommendation. Everything here leaves the stored request and taste alone: it is
// applied to a copy for one ranking, so a repeat notice or a saved taste never counts these as the person's own.
export const RECENT_DAYS = 7;
export const POOR_DAYS = 90;
const DAY = 86400000;
/** Hand-written records promise (ManualRecord) to stay out of recommendations. */
const recommended = (h: HistoryEntry) => !!h.selected && h.selected.roundId !== 'manual';

export type Signals = { recent: Item[]; poor: Item[]; good: Item[] };
const unique = (list: Item[]) => list.filter((item, n) => list.findIndex(o => o.id === item.id) === n);

const GOOD_LIMIT = 10;
/** `current` is the request on screen: what was just chosen in it is not an old choice. */
export function signalsFrom(history: HistoryEntry[], category: Category, current?: string, now = Date.now()): Signals {
  const own = history.filter(h => h.category === category && h.id !== current && recommended(h));
  const recent = own.filter(h => now - Date.parse(h.selected!.date) < RECENT_DAYS * DAY).map(h => h.selected!.result.item);
  // Only the latest rating of an item counts: changing one's mind undoes the earlier one.
  const rated = own.filter(h => h.review?.rating).sort((a, b) => Date.parse(b.review!.date) - Date.parse(a.review!.date));
  const latest = rated.filter((h, n) => rated.findIndex(o => o.selected!.result.item.id === h.selected!.result.item.id) === n);
  const poor = latest.filter(h => h.review!.rating === 'poor' && now - Date.parse(h.review!.date) < POOR_DAYS * DAY).map(h => h.selected!.result.item);
  const good = latest.filter(h => h.review!.rating === 'good').map(h => h.selected!.result.item).slice(0, GOOD_LIMIT);
  return { recent: unique(recent), poor, good };
}

/** Moved behind the rest, not removed: a short list may still need it, and a dish the sentence names is what was asked for. */
export const deferred = (signals: Signals, raw: string) => unique([...signals.poor, ...signals.recent]).filter(item => !raw.includes(item.name));
/** What the results say about it, so a missing favourite is never a mystery. Empty when nothing was moved. */
export function deferredNote(signals: Signals, raw: string): string {
  const moved = deferred(signals, raw), poor = moved.filter(i => signals.poor.some(p => p.id === i.id)).length, recent = moved.length - poor;
  const parts = [recent ? `최근 ${RECENT_DAYS}일 동안 고른 ${recent}개` : '', poor ? `아쉬웠던 ${poor}개` : ''].filter(Boolean);
  return parts.length ? `${parts.join('와 ')}는 뒤로 미뤘어요.` : '';
}

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;  // the server's item id; one bad id would refuse the whole request
const SEEN_LIMIT = 200;
/** A copy to rank with: a server keeps only the last ids for a model, so the ids of this request come last. */
export function rankingSession(session: Session, signals: Signals): Session {
  return { ...session, seenIds: [...new Set([...deferred(signals, session.raw).map(i => i.id).filter(id => ID.test(id)), ...(session.seenIds || [])])].slice(-SEEN_LIMIT) };
}

// Hot dishes and sung songs are most of the catalog, and the hour or the company is not a taste: none of these tell dishes apart.
const NOT_A_TASTE = new Set(['따뜻함', '보컬', '혼자', '함께', '점심', '저녁', '과제', '휴식', '산책', '운동']);
const TAG_LIMIT = 5, PROFILE_TAG_LIMIT = 30;
/** Traits met more often in what was liked than in what was not; only words the server's vocabulary knows. */
function learnedTags(signals: Signals, category: Category): string[] {
  const known = new Set<string>([...vocab[category].conditionTags, ...vocab[category].extraTags]), net = new Map<string, number>();
  for (const [list, by] of [[signals.good, 1], [signals.poor, -1]] as [Item[], number][])
    for (const tag of list.flatMap(i => i.tags)) if (known.has(tag) && !NOT_A_TASTE.has(tag)) net.set(tag, (net.get(tag) || 0) + by);
  return [...net].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TAG_LIMIT).map(([tag]) => tag);
}
// Asked for 담백함, a model told about a well-rated spicy dish answered with four spicy sets out of four (2026-11-09, live API).
// A liked item that is the opposite of this request says nothing about this request, so it is left out of it.
const OPPOSITES: [string, string][] = [['매콤함', '담백함'], ['따뜻함', '차가움'], ['든든함', '가벼움'], ['활기참', '차분함'], ['높은 에너지', '낮은 에너지'], ['높은 에너지', '차분함'], ['활기참', '낮은 에너지'], ['연주곡', '보컬']];
const opposes = (item: Item, wanted: string[]) => OPPOSITES.some(([a, b]) => item.tags.includes(a) && wanted.includes(b) || item.tags.includes(b) && wanted.includes(a));
/** A copy to rank with: the taste as registered, plus what the ratings say about this request (`wanted`). Only the rating is used, never the written note. */
export function rankingProfile(profile: Profile, signals: Signals, category: Category, wanted: string[]): Profile {
  const heard = category === 'food' ? '먹어' : '들어';
  const good = signals.good.filter(i => !opposes(i, wanted));
  return { ...profile, tags: [...new Set([...profile.tags, ...learnedTags({ ...signals, good }, category)])].slice(0, PROFILE_TAG_LIMIT), ratedNotes: good.map(i => `${i.name}: ${heard} 보니 좋았어요`) };
}
