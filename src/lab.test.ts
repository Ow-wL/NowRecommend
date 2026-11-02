import { describe, expect, it } from 'vitest';
import { fetchFreePicks, validFreeBatch } from './api/lab';
import { markKey, pickLabel, readLab, tally, upsertEntry, writeLab, type LabEntry } from './lab';

const pick = (name: string, detail = '가수') => ({ name, detail, tasteReason: '취향', contextReason: '상황' });
const entry = (id: string, extra: Partial<LabEntry> = {}): LabEntry => ({ id, date: '2026-10-26T00:00:00Z', category: 'music', raw: '산책', conditions: { tags: [], excluded: [] }, likedText: [], round: 1, marks: {}, ...extra });
const memory = () => { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } }; };

describe('lab log', () => {
  it('keeps the newest entry first and replaces an updated round', () => {
    const list = upsertEntry(upsertEntry([], entry('a')), entry('b'));
    expect(upsertEntry(list, entry('a', { vote: 'free' })).map(e => [e.id, e.vote])).toEqual([['a', 'free'], ['b', undefined]]);
  });

  it('survives a round trip, ignores damaged data and never reads the v1 music log', () => {
    const storage = memory();
    expect(writeLab([entry('a'), entry('f', { category: 'food' })], storage)).toBe(true);
    expect(readLab(storage).map(e => e.id)).toEqual(['a', 'f']);
    storage.setItem('nowrecommend-lab-v1', JSON.stringify([entry('old')]));
    expect(readLab(storage).map(e => e.id)).toEqual(['a', 'f']);
    storage.setItem('nowrecommend-lab-v2', '{not json');
    expect(readLab(storage)).toEqual([]);
    storage.setItem('nowrecommend-lab-v2', JSON.stringify([{ id: 1 }, { ...entry('no-category'), category: undefined }, entry('b')]));
    expect(readLab(storage).map(e => e.id)).toEqual(['b']);
  });

  it('reports a failed write instead of throwing', () => {
    expect(writeLab([entry('a')], { setItem: () => { throw new Error('quota'); } })).toBe(false);
  });

  it('labels picks the way the server avoid list expects', () => {
    expect(pickLabel(pick('밤편지', '아이유'))).toBe('밤편지 - 아이유');
    expect(pickLabel({ name: '비빔국수', detail: '' })).toBe('비빔국수');
    expect(markKey('free', pick('x'))).toBe('free:x - 가수');
  });

  it('tallies votes, failures, latency and marks per side', () => {
    const a = entry('a', { vote: 'free', pool: { picks: [pick('x'), pick('y')], ms: 1000, status: 'ok' }, free: { picks: [pick('z')], ms: 3000, status: 'ok' },
      marks: { [markKey('free', pick('z'))]: 'missing', [markKey('pool', pick('x'))]: 'good' } });
    const b = entry('b', { vote: 'same', pool: { picks: [], ms: 500, status: 'fallback' }, free: { picks: [], ms: 1000, status: 'failed' } });
    const t = tally([a, b]);
    expect(t.votes).toEqual({ pool: 0, same: 1, free: 1 });
    expect(t.sides.pool).toMatchObject({ answered: 2, failed: 0, picks: 2, good: 1, avgMs: 750 });
    expect(t.sides.free).toMatchObject({ answered: 1, failed: 1, picks: 1, missing: 1, avgMs: 2000 });
  });
});

describe('free recommendation API', () => {
  const freePick = (name: string) => ({ name, detail: '가수', tasteReason: '취향', contextReason: '상황', confidence: 'high', tags: ['차분함'],
    item: { id: 'ai-1', category: 'music', name, subtitle: '가수', description: 'AI', tags: ['차분함'], ingredients: [], emoji: '🎵', color: '#eee' } });
  const ok = { results: [freePick('밤')], meta: { mode: 'free', requestId: 'r', model: 'm', ai: 'used', issues: null, latencyMs: 10 } };

  it('accepts the server shape and rejects broken picks', () => {
    expect(validFreeBatch(ok)).toBe(true);
    expect(validFreeBatch({ ...ok, results: [{ ...freePick('밤'), confidence: 'sure' }] })).toBe(false);
    expect(validFreeBatch({ ...ok, results: [freePick('')] })).toBe(false);
    expect(validFreeBatch({ ...ok, results: [{ ...freePick('밤'), item: { id: 'x' } }] })).toBe(false);
    expect(validFreeBatch({ ...ok, results: [{ ...freePick('비빔국수'), detail: '' }] })).toBe(true);  // food picks may have no detail
    expect(validFreeBatch({ ...ok, meta: { ...ok.meta, mode: 'rag' } })).toBe(false);
  });

  it('sends only what the lab needs, per category, and keeps the latest avoid labels', async () => {
    let sent: any, url = '';
    const fetchImpl = (async (target: string, init: RequestInit) => { url = String(target); sent = JSON.parse(String(init.body)); return new Response(JSON.stringify(ok)); }) as typeof fetch;
    const avoid = Array.from({ length: 70 }, (_, i) => `곡${i} - 가수`);
    await fetchFreePicks('music', { raw: '산책', conditions: { tags: ['산책'], excluded: ['보컬'] }, profile: { selected: ['m01'], tags: [], disliked: [] },
      likedText: Array.from({ length: 12 }, (_, i) => `가수${i}`), avoid, model: 'm' }, { base: 'http://api.test', fetchImpl });
    expect(url).toBe('http://api.test/api/lab/music/free');
    expect(sent.conditions).toEqual({ tags: ['산책'], excluded: ['보컬'] });
    expect(sent.likedText).toHaveLength(10);
    expect(sent.avoid).toEqual(avoid.slice(-60));
    expect(sent.model).toBe('m');
    expect(sent.count).toBe(5);
    await fetchFreePicks('food', { raw: '저녁', conditions: { tags: [], excluded: [] }, profile: { selected: [], tags: [], disliked: [] }, likedText: [], avoid: [] }, { base: 'http://api.test', fetchImpl });
    expect(url).toBe('http://api.test/api/lab/food/free');
    expect(sent.count).toBe(3);
  });
});
