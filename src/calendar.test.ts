import { expect, it } from 'vitest';
import { choicesByDay, matchesHistory, monthCells, seoulDay, shiftMonth } from './calendar';
import { getCatalog } from './catalog';
import { emptyStore } from './domain';
import { addManual, manualEntry, MANUAL_RAW } from './history';
import { decodeStore } from './storage';
it('lays a month out in Sunday-first weeks and moves across years', () => {
  const cells = monthCells(2026, 11);  // November 2026 starts on a Sunday
  expect(cells.length % 7).toBe(0);
  expect(cells[0]).toEqual({ day: '2026-11-01', date: 1 });
  expect(cells.filter(Boolean).length).toBe(30);
  const october = monthCells(2026, 10);  // 1 October 2026 is a Thursday: four blanks first
  expect(october.slice(0, 4)).toEqual([null, null, null, null]);
  expect(october[4]).toEqual({ day: '2026-10-01', date: 1 });
  expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
  expect(seoulDay('2026-11-08T16:30:00Z')).toBe('2026-11-09');  // 01:30 KST the next day
});
it('records a choice made without a recommendation as a valid history entry', () => {
  const item = getCatalog().items.find(i => i.category === 'food')!;
  const entry = manualEntry(item, { rating: 'good', note: ' 맛있었다 ' }, '2026-11-09T03:00:00Z');
  expect(entry.raw).toBe(MANUAL_RAW);
  expect(entry.selected?.result.item.id).toBe(item.id);
  expect(entry.review).toMatchObject({ rating: 'good', note: '맛있었다', itemId: item.id, roundId: 'manual' });
  expect(manualEntry(item, { rating: undefined, note: '' }).review).toBeUndefined();
  const store = { ...emptyStore(), history: addManual([], entry) };
  expect(decodeStore(JSON.stringify(store))?.history[0].selected?.result.item.name).toBe(item.name);
  expect(matchesHistory(entry, item.name.slice(0, 2))).toBe(true);
  expect(matchesHistory(entry, '없는말')).toBe(false);
  expect(matchesHistory(entry, '  ')).toBe(true);
  expect(choicesByDay([entry]).get('2026-11-09')).toEqual({ food: 1, music: 0 });
});
