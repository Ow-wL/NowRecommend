import { expect, it } from 'vitest';
import { emptyConditions, type HistoryEntry, type Recommendation } from './domain';
import { computeStats } from './stats';
const item = (id: string, category: 'food' | 'music', tags: string[]) => ({ id, category, name: id, subtitle: '', description: '', tags, ingredients: [], emoji: '', color: '' });
const pick = (id: string, category: 'food' | 'music', tags: string[], date: string, rating?: 'good' | 'poor'): HistoryEntry => {
  const result = { item: item(id, category, tags), tasteReason: '', contextReason: '' } as unknown as Recommendation;
  return { id: `h-${id}-${date}`, date, category, raw: '', conditions: emptyConditions(), resultIds: [id], rounds: [], selected: { result, roundId: 'r', date },
    ...(rating ? { review: { rating, note: '', date, itemId: id, roundId: 'r' } } : {}) };
};
it('counts only final choices, by month, category, trait and hour band', () => {
  const now = new Date('2026-11-09T03:00:00Z');
  const history: HistoryEntry[] = [
    pick('f1', 'food', ['담백함', '국물'], '2026-11-08T10:10:00Z', 'good'),   // 19:10 KST, evening
    pick('f2', 'food', ['담백함', '따뜻함'], '2026-11-02T09:30:00Z', 'poor'),  // evening
    pick('m1', 'music', ['차분함', '연주곡'], '2026-10-30T11:00:00Z'),          // evening, last month
    pick('f3', 'food', ['매콤함'], '2026-11-05T03:00:00Z'),                      // lunch
    { ...pick('f4', 'food', ['담백함'], '2026-11-06T03:00:00Z'), selected: undefined },  // only seen
  ];
  const stats = computeStats(history, now);
  expect(stats.chosen).toBe(4);
  expect(stats.thisMonth).toBe(3);
  expect(stats.byCategory).toEqual({ food: 3, music: 1 });
  expect(stats.traits).toEqual(['담백함', '국물', '따뜻함']);
  expect(stats.slot).toBe('evening');
  expect(stats.satisfied).toEqual({ good: 1, rated: 2 });
  expect(computeStats([], now)).toMatchObject({ chosen: 0, traits: [], slot: undefined, satisfied: undefined });
  expect(computeStats(history.slice(0, 2), now).slot).toBeUndefined();  // fewer than three choices say nothing about the hour
});
