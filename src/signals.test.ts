import { describe, expect, it } from 'vitest';
import { items, type Item } from './data';
import { emptyProfile, recommend, type HistoryEntry, type Session } from './domain';
import { manualEntry } from './history';
import { recommendBody } from './api/recommend';
import { POOR_DAYS, RECENT_DAYS, deferredNote, rankingProfile, rankingSession, signalsFrom } from './signals';

const NOW = Date.parse('2026-11-09T12:00:00Z'), DAY = 86400000;
const food = items.filter(i => i.category === 'food');
const picked = (item = food[0], daysAgo = 1, id = `h-${item.id}-${daysAgo}`): HistoryEntry => {
  const date = new Date(NOW - daysAgo * DAY).toISOString();
  return { id, date, category: item.category, raw: '저녁', conditions: { tags: [], excluded: [] }, resultIds: [item.id], rounds: [], selected: { result: { item, tasteReason: '', contextReason: '' }, roundId: 'r1', date } };
};
const rated = (item: Item, rating: 'good' | 'neutral' | 'poor', daysAgo = 20, note = ''): HistoryEntry => ({ ...picked(item, daysAgo), review: { rating, note, date: new Date(NOW - daysAgo * DAY).toISOString(), itemId: item.id, roundId: 'r1' } });
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
    expect(rankingSession(many, { recent: [], poor: [], good: [] }).seenIds).toHaveLength(200);
  });
});

describe('ratings', () => {
  const spicy = { ...food[0], id: 's1', name: '매운 찌개', tags: ['매콤함', '따뜻함', '저녁', '국물'] };
  const mild = { ...food[1], id: 's2', name: '순한 죽', tags: ['담백함', '따뜻함', '점심'] };

  it('moves a poorly rated item back for months, but not forever', () => {
    expect(signalsFrom([rated(spicy, 'poor', POOR_DAYS - 1)], 'food', undefined, NOW).poor.map(i => i.id)).toEqual(['s1']);
    expect(signalsFrom([rated(spicy, 'poor', POOR_DAYS + 1)], 'food', undefined, NOW).poor).toEqual([]);
  });

  it('lets the latest rating of an item decide', () => {
    const signals = signalsFrom([rated(spicy, 'good', 2), rated(spicy, 'poor', 30)], 'food', undefined, NOW);
    expect(signals.poor).toEqual([]);
    expect(signals.good.map(i => i.id)).toEqual(['s1']);
  });

  it('learns telling traits from what was liked, and not the ones every dish has', () => {
    const signals = signalsFrom([rated(spicy, 'good')], 'food', undefined, NOW);
    expect(rankingProfile(emptyProfile(), signals, 'food').tags).toEqual(['국물', '매콤함']);
  });

  it('does not learn a trait met as often in what disappointed', () => {
    const other = { ...spicy, id: 's3', name: '매운 볶음', tags: ['매콤함'] };
    const signals = signalsFrom([rated(spicy, 'good'), rated(other, 'poor')], 'food', undefined, NOW);
    expect(rankingProfile(emptyProfile(), signals, 'food').tags).toEqual(['국물']);
  });

  it('keeps the registered taste first and leaves the stored one alone', () => {
    const profile = { ...emptyProfile(), tags: ['담백함'] };
    const ranked = rankingProfile(profile, signalsFrom([rated(spicy, 'good')], 'food', undefined, NOW), 'food');
    expect(ranked.tags[0]).toBe('담백함');
    expect(profile.tags).toEqual(['담백함']);
    expect(profile.ratedNotes).toBeUndefined();
  });

  it('raises dishes like the liked one', () => {
    const catalog = [mild, { ...spicy, id: 's4', name: '다른 매운 국' }];
    const base = recommend(session(), emptyProfile(), catalog).map(r => r.item.id);
    expect(base[0]).toBe('s2');  // ties go to the smaller id
    const profile = rankingProfile(emptyProfile(), signalsFrom([rated(spicy, 'good')], 'food', undefined, NOW), 'food');
    expect(recommend(session(), profile, catalog)[0].item.id).toBe('s4');
  });

  it('tells the AI what was liked, but never the written note', () => {
    const profile = rankingProfile(emptyProfile(), signalsFrom([rated(spicy, 'good', 20, '비밀 메모')], 'food', undefined, NOW), 'food');
    const body = recommendBody(session(), profile);
    expect(body.profile.notes).toEqual(['매운 찌개: 먹어 보니 좋았어요']);
    expect(JSON.stringify(body)).not.toContain('비밀 메모');
  });

  it('sends only vocabulary the server accepts', () => {
    const odd = { ...spicy, tags: ['없는말', '국물'] };
    expect(rankingProfile(emptyProfile(), signalsFrom([rated(odd, 'good')], 'food', undefined, NOW), 'food').tags).toEqual(['국물']);
  });

  it('says what it moved', () => {
    const signals = signalsFrom([picked(food[0], 1), rated(spicy, 'poor')], 'food', undefined, NOW);
    expect(deferredNote(signals, '')).toBe(`최근 ${RECENT_DAYS}일 동안 고른 1개와 아쉬웠던 1개는 뒤로 미뤘어요.`);
    expect(deferredNote({ recent: [], poor: [], good: [] }, '')).toBe('');
  });

  it('ignores ratings on hand-written records', () => {
    const manual = manualEntry(spicy, { rating: 'poor', note: '' }, new Date(NOW - DAY).toISOString());
    expect(signalsFrom([manual], 'food', undefined, NOW).poor).toEqual([]);
  });
});
