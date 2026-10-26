import { describe, expect, it } from 'vitest';
import { fetchFreeSongs, validFreeBatch } from './api/lab';
import { markKey, readLab, tally, upsertEntry, writeLab, type LabEntry } from './lab';

const song = (title: string) => ({ title, artist: '가수', tasteReason: '취향', contextReason: '상황' });
const entry = (id: string, extra: Partial<LabEntry> = {}): LabEntry => ({ id, date: '2026-10-26T00:00:00Z', raw: '산책', conditions: { tags: [], excluded: [] }, likedText: [], round: 1, marks: {}, ...extra });
const memory = () => { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } }; };

describe('lab log', () => {
  it('keeps the newest entry first and replaces an updated round', () => {
    const list = upsertEntry(upsertEntry([], entry('a')), entry('b'));
    expect(upsertEntry(list, entry('a', { vote: 'free' })).map(e => [e.id, e.vote])).toEqual([['a', 'free'], ['b', undefined]]);
  });

  it('survives a round trip and ignores damaged data', () => {
    const storage = memory();
    expect(writeLab([entry('a')], storage)).toBe(true);
    expect(readLab(storage).map(e => e.id)).toEqual(['a']);
    storage.setItem('nowrecommend-lab-v1', '{not json');
    expect(readLab(storage)).toEqual([]);
    storage.setItem('nowrecommend-lab-v1', JSON.stringify([{ id: 1 }, entry('b')]));
    expect(readLab(storage).map(e => e.id)).toEqual(['b']);
  });

  it('reports a failed write instead of throwing', () => {
    expect(writeLab([entry('a')], { setItem: () => { throw new Error('quota'); } })).toBe(false);
  });

  it('tallies votes, failures, latency and marks per side', () => {
    const a = entry('a', { vote: 'free', pool: { songs: [song('x'), song('y')], ms: 1000, status: 'ok' }, free: { songs: [song('z')], ms: 3000, status: 'ok' },
      marks: { [markKey('free', song('z'))]: 'missing', [markKey('pool', song('x'))]: 'good' } });
    const b = entry('b', { vote: 'same', pool: { songs: [], ms: 500, status: 'fallback' }, free: { songs: [], ms: 1000, status: 'failed' } });
    const t = tally([a, b]);
    expect(t.votes).toEqual({ pool: 0, same: 1, free: 1 });
    expect(t.sides.pool).toMatchObject({ answered: 2, failed: 0, songs: 2, good: 1, avgMs: 750 });
    expect(t.sides.free).toMatchObject({ answered: 1, failed: 1, songs: 1, missing: 1, avgMs: 2000 });
  });
});

describe('free recommendation API', () => {
  const ok = { results: [{ ...song('밤'), confidence: 'high' }], meta: { mode: 'free', requestId: 'r', model: 'm', ai: 'used', issues: null, latencyMs: 10 } };

  it('accepts the server shape and rejects broken songs', () => {
    expect(validFreeBatch(ok)).toBe(true);
    expect(validFreeBatch({ ...ok, results: [{ ...song('밤'), confidence: 'sure' }] })).toBe(false);
    expect(validFreeBatch({ ...ok, results: [{ ...song(''), confidence: 'high' }] })).toBe(false);
    expect(validFreeBatch({ ...ok, meta: { ...ok.meta, mode: 'rag' } })).toBe(false);
  });

  it('sends only what the lab needs and keeps the latest avoid labels', async () => {
    let sent: any;
    const fetchImpl = (async (_: string, init: RequestInit) => { sent = JSON.parse(String(init.body)); return new Response(JSON.stringify(ok)); }) as typeof fetch;
    const avoid = Array.from({ length: 70 }, (_, i) => `곡${i} - 가수`);
    await fetchFreeSongs({ raw: '산책', conditions: { tags: ['산책'], excluded: ['보컬'] }, profile: { selected: ['m01'], tags: [], disliked: [] },
      likedText: Array.from({ length: 12 }, (_, i) => `가수${i}`), avoid, model: 'm' }, { base: 'http://api.test', fetchImpl });
    expect(sent.conditions).toEqual({ tags: ['산책'], excluded: ['보컬'] });
    expect(sent.likedText).toHaveLength(10);
    expect(sent.avoid).toEqual(avoid.slice(-60));
    expect(sent.model).toBe('m');
  });
});
