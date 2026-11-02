import { afterEach, describe, expect, it } from 'vitest';
import { items, type Item } from './data';
import { applyBatch, emptyConditions, emptyProfile, recommend, type Session } from './domain';
import { isAiPick, knownItem, rememberItems, resetKnownItems, resolveItem } from './knownItems';

const memory = () => { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } }; };
const aiSong = (id: string, name: string, tags: string[] = ['차분함', '보컬']): Item => ({ id, category: 'music', name, subtitle: 'AI 가수', description: 'AI 추천', tags, ingredients: [], emoji: '🎵', color: '#eee' });
afterEach(resetKnownItems);

describe('remembered AI picks', () => {
  it('stores only items missing from the catalog and resolves them by id', () => {
    const storage = memory();
    expect(rememberItems([items[0], aiSong('ai-1', '새 곡')], items, storage)).toBe(true);
    expect(JSON.parse(storage.getItem('nowrecommend-known-items-v1')!).map((i: Item) => i.id)).toEqual(['ai-1']);
    expect(knownItem('ai-1', storage)?.name).toBe('새 곡');
    expect(resolveItem(items, 'ai-1')?.name).toBe('새 곡');
    expect(resolveItem(items, items[0].id)).toBe(items[0]);
    expect(isAiPick('ai-1') && !isAiPick('m01')).toBe(true);
  });

  it('reports a refused write and ignores damaged data', () => {
    expect(rememberItems([aiSong('ai-2', 'x')], items, { getItem: () => null, setItem: () => { throw new Error('quota'); } })).toBe(false);
    resetKnownItems();
    expect(knownItem('ai-9', { getItem: () => '{broken', setItem: () => {} })).toBeUndefined();
  });
});

describe('server rounds with items outside the catalog', () => {
  const base: Session = { id: 's', category: 'music', raw: '', conditions: emptyConditions(), excludedIds: [], revision: 0 };
  const results = [{ item: aiSong('ai-1', '첫 곡'), tasteReason: 't', contextReason: 'c', confidence: 'high' as const }, { item: aiSong('ai-2', '둘째 곡', ['보컬']), tasteReason: 't', contextReason: 'c' }];

  it('keeps AI picks on screen when the round came from the server', () => {
    const session = { ...applyBatch(base, results), source: 'server' as const };
    expect(recommend(session, emptyProfile(), items).map(r => r.item.id)).toEqual(['ai-1', 'ai-2']);
    expect(recommend(session, emptyProfile(), items)[0].confidence).toBe('high');
  });

  it('still applies this request\'s exclusions, dislikes and excluded traits to them', () => {
    const session = { ...applyBatch(base, results), source: 'server' as const };
    expect(recommend({ ...session, excludedIds: ['ai-1'] }, emptyProfile(), items).map(r => r.item.id)).toEqual(['ai-2']);
    expect(recommend(session, { ...emptyProfile(), disliked: ['ai-2'] }, items).map(r => r.item.id)).toEqual(['ai-1']);
    expect(recommend({ ...session, conditions: { tags: [], excluded: ['보컬'] } }, emptyProfile(), items)).toEqual([]);
  });

  it('drops unknown items from a local round, as before', () => {
    expect(recommend(applyBatch(base, results), emptyProfile(), items)).toEqual([]);
  });
});
