import { afterEach, describe, expect, it } from 'vitest';
import { getCatalog, loadCatalog, resetCatalog, setCatalog } from './catalog';
import { CATALOG_META, items, type Item } from './data';
import { applyBatch, eligibleCandidates, emptyConditions, emptyProfile, nextBatch, recommend, type Session } from './domain';
import { recordRound } from './history';

const BASE = 'http://api.test';
const extra: Item = { ...items[0], id: 'f99', name: '서버 전용 메뉴' };
const response = { catalogVersion: 'db-abc', items: [...items, extra] };
const memory = () => { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } }; };
const ok = (body: unknown) => async () => new Response(JSON.stringify(body));
const down = async () => { throw new TypeError('Failed to fetch'); };
const session = (): Session => ({ id: 's', category: 'food', raw: '', conditions: emptyConditions(), excludedIds: [], revision: 0 });
afterEach(resetCatalog);

describe('catalog loader', () => {
  it('keeps the bundled catalog in offline mode', async () => {
    expect(await loadCatalog({ base: '', fetchImpl: ok(response) })).toBe(false);
    expect(getCatalog()).toMatchObject({ source: 'bundled', version: CATALOG_META.version });
  });
  it('switches to the server catalog and caches it for the tab', async () => {
    const storage = memory();
    expect(await loadCatalog({ base: BASE, fetchImpl: ok(response), storage })).toBe(true);
    expect(getCatalog()).toMatchObject({ source: 'server', version: 'db-abc' });
    resetCatalog();
    expect(await loadCatalog({ base: BASE, fetchImpl: down, storage })).toBe(false);
    expect(getCatalog().items.some(i => i.id === 'f99')).toBe(true); // restored from the tab cache
  });
  it('ignores malformed catalogs', async () => {
    for (const body of [{ catalogVersion: 'x', items: [] }, { catalogVersion: 'x', items: [extra, extra] }, { catalogVersion: 'x', items: [{ ...extra, tags: null }] }]) {
      expect(await loadCatalog({ base: BASE, fetchImpl: ok(body), storage: memory() })).toBe(false);
      expect(getCatalog().source).toBe('bundled');
    }
  });
});

describe('domain uses the active catalog', () => {
  it('filters, recommends and records against it', () => {
    setCatalog({ items: [...items, extra], version: 'db-abc', source: 'server' });
    expect(eligibleCandidates(session(), emptyProfile()).some(i => i.id === 'f99')).toBe(true);
    const round = applyBatch(session(), recommend(session(), emptyProfile()));
    expect(recordRound([], round, round.snapshot!)[0].rounds[0].catalogVersion).toBe('db-abc');
  });
  it('applyBatch on local results is exactly nextBatch', () => {
    const local = nextBatch(session(), emptyProfile());
    const applied = applyBatch(session(), recommend(session(), emptyProfile()));
    expect({ ...applied, roundId: '' }).toEqual({ ...local, roundId: '' });
  });
});
