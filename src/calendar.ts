import type { HistoryEntry } from './domain';

// A month of the history, by Korean calendar day. Only dates and counts: the entries themselves stay in the list below.
export const seoulDay = (when: string | Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(when));
export type Cell = { day: string; date: number } | null;
/** The month's days in weeks that start on Sunday; blanks before the first and after the last day are null. */
export function monthCells(year: number, month: number): Cell[] {
  const lead = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(), days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: Cell[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push({ day: `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`, date: d });
  while (cells.length % 7) cells.push(null);
  return cells;
}
export const monthOf = (day: string) => ({ year: +day.slice(0, 4), month: +day.slice(5, 7) });
export function shiftMonth(year: number, month: number, delta: number) {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12 + 12) % 12 + 1 };
}
export const monthLabel = (year: number, month: number) => `${year}년 ${month}월`;
export const dayLabel = (day: string) => `${+day.slice(5, 7)}월 ${+day.slice(8, 10)}일`;
/** Choices per day, by category, for the dots on the calendar. */
export function choicesByDay(entries: HistoryEntry[]): Map<string, { food: number; music: number }> {
  const map = new Map<string, { food: number; music: number }>();
  for (const h of entries) { const day = seoulDay(h.date), counts = map.get(day) || { food: 0, music: 0 }; if (h.selected) counts[h.category]++; map.set(day, counts); }
  return map;
}
/** The sentence, the chosen item or the item the round showed first: anything the person might remember it by. */
export function matchesHistory(h: HistoryEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const shown = h.selected?.result.item || h.rounds.at(-1)?.results[0]?.item;
  return [h.raw, shown?.name, shown?.subtitle, ...h.conditions.tags].some(text => text?.toLowerCase().includes(q));
}
