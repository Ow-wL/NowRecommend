import { describe, expect, it } from 'vitest';
import { items } from './data';
import { emptyProfile, recommend, type HistoryEntry, type Session } from './domain';
import { manualEntry } from './history';
import { RECENT_DAYS, rankingSession, signalsFrom } from './signals';

const NOW = Date.parse('2026-11-09T12:00:00Z'), DAY = 86400000;
const food = items.filter(i => i.category === 'food');
const picked = (item = food[0], daysAgo = 1, id = `h-${item.id}-${daysAgo}`): HistoryEntry => {
  const date = new Date(NOW - daysAgo * DAY).toISOString();
  return { id, date, category: item.category, raw: '저녁', conditions: { tags: [], excluded: [] }, resultIds: [item.id], rounds: [], selected: { result: { item, tasteReason: '', contextReason: '' }, roundId: 'r1', date } };
};
const session = (raw = ''): Session => ({ category: 'food', raw, conditions: { tags: [], excluded: [] }, excludedIds: [], revision: 0 });

describe('recent choices', () => {
  it('counts only this category inside the window', () => {
    const song = items.find(i => i.category === 'music')!;
    const signals = signalsFrom([picked(food[0], 1), picked(food[1], RECENT_DAYS + 1), picked(song, 1)], 'food', undefined, NOW);
    expect(signals.recent.map(i => i.id)).toEqual([food[0].id]);
  });

  it('leaves out hand-written records and the request on screen', () => {
    const manual = manualEntry(food[0], undefined, new Date(NOW - DAY).toISOString());
    expect(signalsFrom([manual], 'food', undefined, NOW).recent).toEqual([]);
    expect(signalsFrom([picked(food[0], 1, 'now')], 'food', 'now', NOW).recent).toEqual([]);
  });

  it('moves a recent choice behind the others without removing it', () => {
    const first = recommend(session(), emptyProfile(), food)[0].item;
    const signals = signalsFrom([picked(first, 1)], 'food', undefined, NOW);
    expect(recommend(rankingSession(session(), signals), emptyProfile(), food).map(r => r.item.id)).not.toContain(first.id);
    expect(recommend(rankingSession(session(), signals), emptyProfile(), [first]).map(r => r.item.id)).toEqual([first.id]);
  });

  it('does not push back a dish the sentence asks for by name', () => {
    const signals = signalsFrom([picked(food[0], 1)], 'food', undefined, NOW);
    expect(rankingSession(session(`${food[0].name} 먹고 싶어`), signals).seenIds).toEqual([]);
  });

  it('keeps the original request untouched and this request last', () => {
    const base = { ...session(), seenIds: ['f09'] };
    expect(rankingSession(base, signalsFrom([picked(food[0], 1)], 'food', undefined, NOW)).seenIds).toEqual([food[0].id, 'f09']);
    expect(base.seenIds).toEqual(['f09']);
  });

  it('drops an id the server would refuse and stays inside its limit', () => {
    const odd = { ...food[0], id: 'Not Valid' };
    expect(rankingSession(session(), signalsFrom([picked(odd, 1)], 'food', undefined, NOW)).seenIds).toEqual([]);
    const many = { ...session(), seenIds: Array.from({ length: 300 }, (_, n) => `x${n}`) };
    expect(rankingSession(many, { recent: [] }).seenIds).toHaveLength(200);
  });
});
