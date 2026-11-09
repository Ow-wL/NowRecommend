import type { Category } from './data';
import type { HistoryEntry } from './domain';
import { slotLabel, timeSlot, type Slot } from './moment';

// Small facts from the person's own records, computed in the browser from what is already stored. Only final choices
// count: a recommendation that was merely seen says nothing about taste.
export type Stats = {
  chosen: number; thisMonth: number; byCategory: Record<Category, number>;
  /** The traits of chosen items, most frequent first (at most three). */ traits: string[];
  /** The hour band most choices fall in, when there are at least three. */ slot?: Slot;
  /** How many of the reviewed choices were rated 만족. */ satisfied?: { good: number; rated: number };
};
const seoulMonth = (d: Date) => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', timeZone: 'Asia/Seoul' }).format(d);
export function computeStats(history: HistoryEntry[], now = new Date()): Stats {
  const chosen = history.filter(h => h.selected);
  const month = seoulMonth(now);
  const counts = new Map<string, number>();
  for (const h of chosen) for (const tag of h.selected!.result.item.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
  const traits = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko')).slice(0, 3).map(([tag]) => tag);
  const slots = new Map<Slot, number>();
  for (const h of chosen) { const slot = timeSlot(new Date(h.selected!.date)); slots.set(slot, (slots.get(slot) || 0) + 1); }
  const slot = chosen.length >= 3 ? [...slots].sort((a, b) => b[1] - a[1])[0]?.[0] : undefined;
  const rated = chosen.filter(h => h.review?.rating);
  return {
    chosen: chosen.length, thisMonth: chosen.filter(h => seoulMonth(new Date(h.selected!.date)) === month).length,
    byCategory: { food: chosen.filter(h => h.category === 'food').length, music: chosen.filter(h => h.category === 'music').length },
    traits, slot, satisfied: rated.length ? { good: rated.filter(h => h.review!.rating === 'good').length, rated: rated.length } : undefined,
  };
}
export const slotSentence = (slot: Slot) => slot === 'lunch' ? '점심시간에 자주 골라요' : slot === 'night' ? '밤에 자주 골라요' : `${slotLabel[slot]}에 자주 골라요`;
