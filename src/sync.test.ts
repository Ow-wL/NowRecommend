import { describe, expect, it } from 'vitest';
import { emptyStore, type HistoryEntry, type Store } from './domain';
import { decodeStore } from './storage';
import { AccountDataError, canonical, indexStore, mark, mergeStores, metaFor, planLogin, readSyncMeta, storeMark, syncStore, writeSyncMeta, type SyncApi, type SyncMeta } from './sync';

const entry = (id: string, date: string, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({ id, date, category: 'food', raw: `요청 ${id}`, conditions: { tags: [], excluded: [] }, resultIds: [], rounds: [], ...extra });
const make = (change: Partial<Store> = {}): Store => ({ ...emptyStore(), name: '주형', ...change });
const liked = (store: Store, selected: string[], disliked: string[] = []): Store => ({ ...store, profiles: { ...store.profiles, food: { ...store.profiles.food, selected, disliked } } });
const account = { token: 't.sig', user: { id: 'u1', email: 'a@b.co', name: '주형' } };
const conflict = () => Object.assign(new Error('409'), { status: 409 });

/** The account as the server keeps it: one store, a version that moves on every save, a save refused on a stale version. */
function server(initial: Store | null = null) {
  const state = { store: initial, version: initial ? 1 : 0, calls: [] as string[], down: false, unreadable: false, legacy: false, beforePush: null as null | (() => void) };
  const api: SyncApi = {
    fetch: async () => { state.calls.push('get'); if (state.down) throw new Error('offline'); return { store: state.store && structuredClone(state.store), version: state.legacy ? null : state.version, unreadable: state.unreadable }; },
    push: async (next, base) => {
      state.calls.push(`put@${base}`);
      if (state.down) throw new Error('offline');
      state.beforePush?.(); state.beforePush = null;
      if (!state.legacy && base !== state.version) throw conflict();  // a server without versions takes whatever comes
      state.store = structuredClone(next); state.version++;
      return { version: state.legacy ? null : state.version };
    },
  };
  return { state, api };
}
/** A browser signed in to the account: its store, and what it remembers of the last agreement. */
function device(store: Store, meta: SyncMeta | null = null) {
  const self = { store, meta, sync: async (api: SyncApi, start: 'push' | 'pull' = 'push') => { const done = await syncStore(self.store, self.meta, 'u1', api, start); self.store = done.store; self.meta = done.meta; return done; } };
  return self;
}

describe('fingerprints', () => {
  it('ignore key order and undefined, as the server returns keys in its own order', () => {
    expect(canonical({ b: 1, a: [{ d: undefined, c: '가' }] })).toBe('{"a":[{"c":"가"}],"b":1}');
    expect(mark({ a: 1, b: { c: 2, d: 3 } })).toBe(mark({ b: { d: 3, c: 2 }, a: 1 }));
    expect(mark({ a: 1 })).not.toBe(mark({ a: 2 }));
    const store = make({ favorites: ['f01'], history: [entry('h1', '2026-11-01T00:00:00Z')] });
    const reordered = JSON.parse(JSON.stringify(store, Object.keys(store).sort().reverse().concat(['food', 'music', 'selected', 'tags', 'disliked', 'id', 'date', 'category', 'raw', 'conditions', 'excluded', 'resultIds', 'rounds'])));
    expect(storeMark(reordered)).toBe(storeMark(store));
    expect(storeMark(liked(store, ['f02']))).not.toBe(storeMark(store));
  });
});

describe('merging two copies', () => {
  const h1 = entry('h1', '2026-11-01T00:00:00Z'), h2 = entry('h2', '2026-11-02T00:00:00Z'), h3 = entry('h3', '2026-11-03T00:00:00Z');
  const agreed = liked(make({ favorites: ['f01', 'f05'], history: [h2, h1] }), ['f01', 'f02'], ['f09']);
  const base = indexStore(agreed);

  it('keeps what the other device added when a tab left open saves a small change (the loss of 2026-11-16)', () => {
    const phone = liked({ ...agreed, favorites: ['f01', 'f05', 'm03'], history: [h3, h2, h1] }, ['f01', 'f02', 'f07'], ['f09']);
    const laptop = { ...agreed, favorites: ['f01'] };  // the old tab: one favourite removed, nothing else known
    const merged = mergeStores(base, laptop, phone);
    expect(merged.favorites).toEqual(['f01', 'm03']);
    expect(merged.history.map(h => h.id)).toEqual(['h3', 'h2', 'h1']);
    expect(merged.profiles.food.selected).toEqual(['f01', 'f02', 'f07']);
    expect(mergeStores(base, phone, laptop).favorites.sort()).toEqual(['f01', 'm03']);  // the same from the phone's side
  });
  it('keeps removals from both sides and additions from both sides', () => {
    const local = liked({ ...agreed, favorites: ['f05', 'f20'], history: [h2] }, ['f02'], ['f09', 'f30']);
    const remote = liked({ ...agreed, favorites: ['f01', 'f21'], history: [h3, h1] }, ['f01', 'f02', 'f08'], []);
    const merged = mergeStores(base, local, remote);
    expect(merged.favorites).toEqual(['f21', 'f20']);            // f01 removed here, f05 removed there
    expect(merged.history.map(h => h.id)).toEqual(['h3']);       // h1 removed here, h2 removed there, h3 new there
    expect(merged.profiles.food).toMatchObject({ selected: ['f02', 'f08'], disliked: ['f30'] });
  });
  it('does not drop an entry the other side edited, and lets the later edit win when both edited', () => {
    const reviewed = { ...h1, selected: { result: { item: { id: 'f01' } } as any, date: '2026-11-05T00:00:00Z', roundId: 'r1' } };
    expect(mergeStores(base, { ...agreed, history: [h2] }, { ...agreed, history: [h2, reviewed] }).history.map(h => h.id)).toEqual(['h1', 'h2']);  // removed here, edited there
    expect(mergeStores(base, { ...agreed, history: [h2, reviewed] }, { ...agreed, history: [h2] }).history.map(h => h.id)).toEqual(['h1', 'h2']);  // edited here, removed there
    const older = { ...h1, raw: '여기서 고침', rounds: [{ id: 'r1', date: '2026-11-04T00:00:00Z', raw: '', conditions: { tags: [], excluded: [] }, results: [], feedback: [], excludedIds: [] }] };
    const both = mergeStores(base, { ...agreed, history: [older, h2] }, { ...agreed, history: [reviewed, h2] });
    expect(both.history.find(h => h.id === 'h1')).toEqual(reviewed);
  });
  it('lets the side that changed a single value win, this browser on a tie', () => {
    const local = { ...agreed, name: '여기 이름' }, remote = { ...agreed, name: '저기 이름', appearance: { mode: 'dark' as const } };
    expect(mergeStores(base, local, remote)).toMatchObject({ name: '여기 이름', appearance: { mode: 'dark' } });
    expect(mergeStores(base, agreed, remote).name).toBe('저기 이름');
    expect(mergeStores(base, { ...agreed, appearance: { mode: 'light' } }, agreed).appearance).toEqual({ mode: 'light' });
  });
  it('unites the two when there is no agreed copy to compare with: nothing counts as removed', () => {
    const local = liked(make({ name: emptyStore().name, favorites: ['f05'], history: [h1] }), ['f01']);
    const remote = liked(make({ favorites: ['m01'], history: [h2] }), ['f07'], ['f01']);
    const merged = mergeStores(null, local, remote);
    expect(merged.favorites).toEqual(['m01', 'f05']);
    expect(merged.history.map(h => h.id)).toEqual(['h2', 'h1']);
    expect(merged.name).toBe('주형');  // a browser that never named itself takes the account's name
    // f01 is liked here and disliked there: one item cannot be both, and this browser's choice stands.
    expect(merged.profiles.food).toMatchObject({ selected: ['f07', 'f01'], disliked: [] });
  });
  it('with nothing to compare against, a setting only the account has is kept: absence is not a removal', () => {
    const remote = make({ appearance: { mode: 'dark' }, tasteTypes: { food: { code: 'ABCD' } as any } });
    const merged = mergeStores(null, make(), remote);
    expect(merged.appearance).toEqual({ mode: 'dark' });
    expect(merged.tasteTypes).toEqual({ food: { code: 'ABCD' } });
    expect(mergeStores(null, make({ appearance: { mode: 'light' } }), remote).appearance).toEqual({ mode: 'light' });  // both have one: this browser's
    // With an agreed copy, removing a setting here is a change like any other.
    expect(mergeStores(indexStore(remote), { ...remote, appearance: undefined }, remote).appearance).toBeUndefined();
  });
  it('merges presets, typed-in tastes and reasons by id, and stays within the limits the app can read', () => {
    const preset = (id: string, category: 'food' | 'music' = 'food') => ({ id, category, name: id, conditions: { tags: [], excluded: [] } });
    const withCustom = (store: Store, custom: { id: string; name: string }[], reasons: Record<string, string>): Store => ({ ...store, profiles: { ...store.profiles, food: { ...store.profiles.food, custom, reasons } } });
    const start = withCustom({ ...agreed, presets: [preset('p1'), preset('p2')] }, [{ id: 'c1', name: '엄마 김치찌개' }], { f01: '바삭해서' });
    const local = withCustom({ ...start, presets: [preset('p2'), preset('p3')] }, [{ id: 'c1', name: '엄마 김치찌개' }, { id: 'c2', name: '동네 떡볶이' }], { f01: '바삭해서', f02: '담백해서' });
    const remote = withCustom({ ...start, presets: [preset('p1'), preset('p2'), preset('p4', 'music')] }, [], { f01: '고소해서' });
    const merged = mergeStores(indexStore(start), local, remote);
    expect(merged.presets!.map(p => p.id)).toEqual(['p2', 'p4', 'p3']);
    expect(merged.profiles.food.custom).toEqual([{ id: 'c2', name: '동네 떡볶이' }]);
    expect(merged.profiles.food.reasons).toEqual({ f01: '고소해서', f02: '담백해서' });

    const many = (prefix: string) => Array.from({ length: 40 }, (_, i) => entry(`${prefix}${i}`, new Date(Date.UTC(2026, 9, 1, i)).toISOString()));
    const crowded = mergeStores(null, make({ history: many('a'), presets: Array.from({ length: 20 }, (_, i) => preset(`l${i}`)) }), make({ history: many('b'), presets: Array.from({ length: 20 }, (_, i) => preset(`r${i}`)) }));
    expect(crowded.history).toHaveLength(50);
    expect(crowded.history[0].id).toMatch(/39$/);  // newest first
    expect(crowded.presets).toHaveLength(20);
    expect(decodeStore(JSON.stringify(crowded))).not.toBeNull();
    expect(decodeStore(JSON.stringify(merged))).not.toBeNull();
  });
});

describe('sync protocol', () => {
  it('saves on top of the version it knows and remembers the new one', async () => {
    const { state, api } = server(make({ favorites: ['f01'] }));
    const laptop = device(make({ favorites: ['f01'] }), metaFor('u1', 1, make({ favorites: ['f01'] })));
    laptop.store = { ...laptop.store, favorites: ['f01', 'f02'] };
    const done = await laptop.sync(api);
    expect(state.calls).toEqual(['put@1']);
    expect(done).toMatchObject({ replaced: false, meta: { version: 2, mark: storeMark(laptop.store) } });
    expect(state.store!.favorites).toEqual(['f01', 'f02']);
  });
  it('two devices: the one that missed a save is refused, reads, merges and saves again, and nothing is lost', async () => {
    const start = make({ favorites: ['f01', 'f05'] });
    const { state, api } = server(start);
    const phone = device(start, metaFor('u1', 1, start)), laptop = device(start, metaFor('u1', 1, start));
    phone.store = { ...phone.store, favorites: ['f01', 'f05', 'm03'], history: [entry('h9', '2026-11-10T00:00:00Z')] };
    await phone.sync(api);
    laptop.store = { ...laptop.store, favorites: ['f01'] };
    const done = await laptop.sync(api);
    expect(state.calls).toEqual(['put@1', 'put@1', 'get', 'put@2']);
    expect(done.replaced).toBe(true);
    expect(state.store).toMatchObject({ favorites: ['f01', 'm03'], history: [{ id: 'h9' }] });
    expect(state.version).toBe(3);
    await phone.sync(api, 'pull');  // the phone opens the app again
    expect(phone.store).toEqual(laptop.store);
    expect(state.calls.slice(4)).toEqual(['get']);  // already what the account has: nothing uploaded
  });
  it('opening the app reads the account first, and uploads only what the account lacks', async () => {
    const start = make({ favorites: ['f01'] });
    const { state, api } = server({ ...start, favorites: ['f01', 'f02'] });
    state.version = 4;
    const stale = device(start, metaFor('u1', 1, start));
    expect(await stale.sync(api, 'pull')).toMatchObject({ replaced: true, meta: { version: 4 } });
    expect(state.calls).toEqual(['get']);
    expect(stale.store.favorites).toEqual(['f01', 'f02']);
  });
  it('a browser from before versions (no memory of an agreement) reads and unites instead of overwriting', async () => {
    const { state, api } = server(make({ favorites: ['m01'], history: [entry('h1', '2026-11-01T00:00:00Z')] }));
    const old = device(make({ favorites: ['f05'] }));
    await old.sync(api);
    expect(state.calls).toEqual(['get', 'put@1']);
    expect(state.store).toMatchObject({ favorites: ['m01', 'f05'], history: [{ id: 'h1' }] });
  });
  it('an account with nothing saved takes this browser’s store', async () => {
    const { state, api } = server(null);
    const fresh = device(make({ favorites: ['f05'] }));
    expect((await fresh.sync(api)).meta.version).toBe(1);
    expect(state.calls).toEqual(['get', 'put@0']);
  });
  it('two browsers meeting an empty account at once: the second is refused, reads and merges', async () => {
    const { state, api } = server(null);
    const first = device(make({ favorites: ['f01'] })), second = device(make({ favorites: ['f02'] }));
    state.beforePush = () => { state.store = structuredClone(first.store); state.version = 1; };  // the first one's save lands in between
    await second.sync(api);
    expect(state.calls).toEqual(['get', 'put@0', 'get', 'put@1']);
    expect(state.store!.favorites).toEqual(['f01', 'f02']);
  });
  it('a server that keeps no versions (an older API): every save is preceded by a read and a merge', async () => {
    const start = make({ favorites: ['f01'] });
    const { state, api } = server(start);
    state.legacy = true;
    const laptop = device(start);
    await laptop.sync(api);                                   // first contact
    expect(laptop.meta!.version).toBeNull();
    state.store = { ...start, favorites: ['f01', 'm03'] };    // the phone saves
    laptop.store = { ...laptop.store, favorites: [] };        // the laptop removes one
    state.calls.length = 0;
    await laptop.sync(api);
    expect(state.calls).toEqual(['get', 'put@null']);         // never a save on trust
    expect(state.store!.favorites).toEqual(['m03']);
    // The server gains versions later (rolled forward): the browser learns the number and saves on top of it again.
    state.legacy = false;
    laptop.store = { ...laptop.store, favorites: ['m03', 'f09'] };
    await laptop.sync(api);
    expect(laptop.meta!.version).toBe(state.version);
    expect(state.store!.favorites).toEqual(['m03', 'f09']);
  });
  it('never uploads when the account’s copy could not be read', async () => {
    const { state, api } = server(make({ favorites: ['m01'] }));
    state.down = true;
    await expect(device(make()).sync(api)).rejects.toThrow('offline');
    state.down = false; state.unreadable = true;
    await expect(device(make()).sync(api)).rejects.toBeInstanceOf(AccountDataError);
    expect(state.calls.some(c => c.startsWith('put'))).toBe(false);
    expect(state.store!.favorites).toEqual(['m01']);
  });
  it('gives up after repeated refusals instead of forcing the save', async () => {
    const start = make();
    const api: SyncApi = { fetch: async () => ({ store: make({ favorites: ['m01'] }), version: 9 }), push: async () => { throw conflict(); } };
    await expect(syncStore({ ...start, favorites: ['f01'] }, metaFor('u1', 1, start), 'u1', api)).rejects.toThrow('kept changing');
  });
  it('ignores the memory of another account', async () => {
    const { state, api } = server(make({ favorites: ['m01'] }));
    const theirs = make({ favorites: ['f05'] });
    await syncStore(theirs, metaFor('someone-else', 1, theirs), 'u1', api);
    expect(state.calls[0]).toBe('get');  // no save on top of a version that belongs to another account
  });
});

describe('signing in', () => {
  const guest = make({ name: emptyStore().name, favorites: ['f05'] });
  const remote = { store: make({ favorites: ['m01'] }), version: 3 };
  it('data used without an account becomes the account’s only if the account has none', () => {
    expect(planLogin(guest, null, { store: null, version: 0 }, account)).toMatchObject({ action: 'uploaded', keepAside: false, meta: { userId: 'u1', version: 0, base: { favorites: [] } }, store: { name: '주형', favorites: ['f05'] } });
    const down = planLogin(guest, null, remote, account);
    expect(down).toMatchObject({ action: 'downloaded', keepAside: true, store: { favorites: ['m01'] }, meta: { userId: 'u1', version: 3 } });
    expect(down.meta!.mark).toBe(storeMark(down.store));  // nothing to upload after a download
  });
  it('another account’s data left in the browser is never uploaded', () => {
    const left = make({ name: '지은', favorites: ['f05'] }), theirs = metaFor('u2', 8, left);
    expect(planLogin(left, theirs, { store: null, version: 0 }, account)).toMatchObject({ action: 'fresh', keepAside: true, meta: { userId: 'u1', version: 0 }, store: { name: '주형', favorites: [] } });
    expect(planLogin(left, theirs, remote, account)).toMatchObject({ action: 'downloaded', keepAside: true, store: { favorites: ['m01'] } });
  });
  it('the same account signing in again merges what changed here while signed out', () => {
    const agreed = make({ favorites: ['f01'] }), mine = metaFor('u1', 2, agreed);
    const plan = planLogin({ ...agreed, favorites: ['f01', 'f02'] }, mine, { store: { ...agreed, favorites: ['f01', 'm01'] }, version: 3 }, account);
    expect(plan).toMatchObject({ action: 'merged', keepAside: false, store: { favorites: ['f01', 'm01', 'f02'] }, meta: { version: 3 } });
    expect(plan.meta!.mark).not.toBe(storeMark(plan.store));  // the merge is still to be saved
    expect(planLogin(agreed, mine, { store: agreed, version: 2 }, account).action).toBe('downloaded');
  });
  it('refuses to sign in over a copy it cannot read', () => {
    expect(() => planLogin(guest, null, { store: null, version: 5, unreadable: true }, account)).toThrow(AccountDataError);
  });
});

describe('sync memory', () => {
  const memory = () => { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } }; };
  it('round-trips and rejects anything malformed', () => {
    const storage = memory(), meta = metaFor('u1', 4, make({ favorites: ['f01'], history: [entry('h1', '2026-11-01T00:00:00Z')] }));
    expect(writeSyncMeta(meta, storage)).toBe(true);
    expect(readSyncMeta(storage)).toEqual(meta);
    storage.setItem('nowrecommend-sync-v1', JSON.stringify({ ...meta, base: { ...meta.base, favorites: [1] } }));
    expect(readSyncMeta(storage)).toBeNull();
    storage.setItem('nowrecommend-sync-v1', '{oops');
    expect(readSyncMeta(storage)).toBeNull();
    writeSyncMeta(null, storage);
    expect(readSyncMeta(storage)).toBeNull();
  });
});
