import type { Category, Item } from './data';
import type { HistoryEntry, Session } from './domain';

// What the record says about the next recommendation. Everything here leaves the stored request and taste alone: it is
// applied to a copy for one ranking, so a repeat notice or a saved taste never counts these as the person's own.
export const RECENT_DAYS = 7;
const DAY = 86400000;
/** Hand-written records promise (ManualRecord) to stay out of recommendations. */
const recommended = (h: HistoryEntry) => !!h.selected && h.selected.roundId !== 'manual';

export type Signals = { recent: Item[] };

/** `current` is the request on screen: what was just chosen in it is not an old choice. */
export function signalsFrom(history: HistoryEntry[], category: Category, current?: string, now = Date.now()): Signals {
  const own = history.filter(h => h.category === category && h.id !== current && recommended(h));
  const recent = own.filter(h => now - Date.parse(h.selected!.date) < RECENT_DAYS * DAY).map(h => h.selected!.result.item);
  return { recent: recent.filter((item, n) => recent.findIndex(o => o.id === item.id) === n) };
}

/** Moved behind the rest, not removed: a short list may still need it, and a dish the sentence names is what was asked for. */
export const deferred = (signals: Signals, raw: string) => signals.recent.filter(item => !raw.includes(item.name));

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;  // the server's item id; one bad id would refuse the whole request
const SEEN_LIMIT = 200;
/** A copy to rank with: a server keeps only the last ids for a model, so the ids of this request come last. */
export function rankingSession(session: Session, signals: Signals): Session {
  return { ...session, seenIds: [...new Set([...deferred(signals, session.raw).map(i => i.id).filter(id => ID.test(id)), ...(session.seenIds || [])])].slice(-SEEN_LIMIT) };
}
