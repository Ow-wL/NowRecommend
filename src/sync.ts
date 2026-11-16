import { emptyStore, type CustomTaste, type HistoryEntry, type Preset, type Profile, type Store } from './domain';
import type { Category } from './data';
import type { Account } from './account';

// Account sync without losing data (2026-11-16). The account holds one copy of the Store with a version number that
// moves on every save. A browser remembers which version it last agreed with and a small index of that copy (`base`,
// saved in the same localStorage record as the store),
// so when another device saved in between it can tell what each side changed and merge instead of overwriting:
//   lists (favourites, liked, disliked, tags): what one side added stays added, what it removed stays removed;
//   history, presets, typed-in tastes (by id): an entry only one side touched is taken from that side, and when both
//     touched it the one with the later activity wins, so an edit is never dropped for a deletion;
//   single values (name, appearance, taste type): the side that changed it wins, this browser on a tie.
// Without a base (a browser from before this change, or first contact) nothing is treated as removed: the two are united.

const CATEGORIES: Category[] = ['food', 'music'];
const LISTS = ['selected', 'tags', 'disliked'] as const;

/** JSON with sorted keys and no undefined: the server's JSONB reorders keys, so plain JSON.stringify cannot compare copies. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(v => canonical(v === undefined ? null : v)).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(k => (value as any)[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical((value as any)[k])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
/** A short fingerprint of a value (length + FNV-1a): equal values give equal marks, and the index stays a few KB. */
export function mark(value: unknown): string {
  const text = canonical(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return `${text.length.toString(36)}.${(hash >>> 0).toString(36)}`;
}
/** Only what is stored: `ratedNotes` is added for one ranking and never kept. */
const stored = (store: Store): Store => ({ ...store, profiles: Object.fromEntries(CATEGORIES.map(c => { const { ratedNotes: _, ...rest } = store.profiles[c]; return [c, rest]; })) as Store['profiles'] });
export const storeMark = (store: Store) => mark(stored(store));

type ProfileIndex = { selected: string[]; tags: string[]; disliked: string[]; reasons: Record<string, string>; custom: Record<string, string> };
export type StoreIndex = { name: string; appearance: string; tasteTypes: Record<string, string>; favorites: string[]; profiles: Record<Category, ProfileIndex>; history: Record<string, string>; presets: Record<string, string> };
/** `mark` is the whole store's fingerprint at that version: a store with another mark has changes the account lacks.
 * `version` is null for a server that keeps no versions (an API revision from before 2026-11-16): it cannot refuse a
 * stale save, so there every save is preceded by a read and a merge instead of being sent on trust. */
export type SyncMeta = { userId: string; version: number | null; base: StoreIndex; mark: string };

const marks = <T extends { id: string }>(list: T[] | undefined) => Object.fromEntries((list || []).map(x => [x.id, mark(x)]));
export function indexStore(store: Store): StoreIndex {
  return {
    name: store.name, appearance: mark(store.appearance ?? null),
    tasteTypes: Object.fromEntries(CATEGORIES.map(c => [c, mark(store.tasteTypes?.[c] ?? null)])),
    favorites: [...store.favorites],
    profiles: Object.fromEntries(CATEGORIES.map(c => { const p = store.profiles[c]; return [c, { selected: [...p.selected], tags: [...p.tags], disliked: [...p.disliked], reasons: { ...(p.reasons || {}) }, custom: marks(p.custom) }]; })) as StoreIndex['profiles'],
    history: marks(store.history), presets: marks(store.presets),
  };
}
export const metaFor = (userId: string, version: number | null, store: Store): SyncMeta => ({ userId, version, base: indexStore(store), mark: storeMark(store) });

const texts = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
const textMap = (v: unknown): v is Record<string, string> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(x => typeof x === 'string');
function validIndex(v: any): v is StoreIndex {
  return !!v && typeof v.name === 'string' && typeof v.appearance === 'string' && textMap(v.tasteTypes) && texts(v.favorites) && textMap(v.history) && textMap(v.presets)
    && CATEGORIES.every(c => { const p = v.profiles?.[c]; return !!p && LISTS.every(k => texts(p[k])) && textMap(p.reasons) && textMap(p.custom); });
}
/** The agreement as it was saved next to the store (src/storage.ts), or null when there is none or it is malformed. */
export function parseSyncMeta(v: any): SyncMeta | null {
  return v && typeof v.userId === 'string' && (v.version === null || Number.isInteger(v.version) && v.version >= 0) && typeof v.mark === 'string' && validIndex(v.base)
    ? { userId: v.userId, version: v.version, base: v.base, mark: v.mark } : null;
}

// ---- merge ----

/** The account's order, without what this browser removed, then what this browser added. */
function mergeList(base: string[] | undefined, local: string[], remote: string[]): string[] {
  const b = new Set(base || []), l = new Set(local), r = new Set(remote);
  return [...new Set([...remote.filter(x => l.has(x) || !b.has(x)), ...local.filter(x => !r.has(x) && !b.has(x))])];
}
function mergeMap(base: Record<string, string> | undefined, local: Record<string, string>, remote: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of new Set([...Object.keys(remote), ...Object.keys(local)])) {
    const l = local[key], r = remote[key], b = base?.[key];
    const value = l === r ? l : !base ? (l ?? r) : l === b ? r : l;  // this browser's value unless only the account changed it
    if (value !== undefined) out[key] = value;
  }
  return out;
}
/** Entries by id. `newer` settles an entry both sides changed. A removal only holds against an entry the other side left alone. */
function mergeById<T extends { id: string }>(base: Record<string, string> | undefined, local: T[], remote: T[], newer: (local: T, remote: T) => T): T[] {
  const l = new Map(local.map(x => [x.id, x])), r = new Map(remote.map(x => [x.id, x]));
  const out: T[] = [];
  for (const theirs of remote) {
    const mine = l.get(theirs.id), was = base?.[theirs.id];
    if (!mine) { if (was === undefined || was !== mark(theirs)) out.push(theirs); continue; }  // removed here: kept only if new or edited there
    const lm = mark(mine), rm = mark(theirs);
    out.push(lm === rm || rm === was ? mine : lm === was ? theirs : newer(mine, theirs));
  }
  for (const mine of local) {
    if (r.has(mine.id)) continue;
    const was = base?.[mine.id];
    if (was === undefined || was !== mark(mine)) out.push(mine);  // new here, or removed there but edited here
  }
  return out;
}
const time = (v: string | undefined) => { const t = v ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : 0; };
/** When an entry was last touched: its start, its latest round or feedback, the choice, the review. */
export const lastActivity = (h: HistoryEntry) => Math.max(time(h.date), time(h.selected?.date), time(h.review?.date), ...h.rounds.flatMap(r => [time(r.date), ...r.feedback.map(f => time(f.date))]));
/** A single value: the side that changed it wins, this browser on a tie. With nothing to compare against, a value only one side has is kept (absence is not a removal). */
const single = <T>(was: string | undefined, local: T, remote: T): T => was === undefined ? (local ?? remote) : mark(local ?? null) === mark(remote ?? null) || mark(local ?? null) !== was ? local : remote;

function mergeProfile(base: ProfileIndex | undefined, local: Profile, remote: Profile): Profile {
  const lists = Object.fromEntries(LISTS.map(k => [k, mergeList(base?.[k], local[k], remote[k])])) as Pick<Profile, typeof LISTS[number]>;
  // One item cannot be both liked and disliked: where the two sides disagree, this browser's choice stands.
  const liked = new Set(local.selected), avoided = new Set(local.disliked);
  lists.selected = lists.selected.filter(id => !lists.disliked.includes(id) || liked.has(id) || !avoided.has(id));
  lists.disliked = lists.disliked.filter(id => !lists.selected.includes(id));
  const reasons = mergeMap(base?.reasons, local.reasons || {}, remote.reasons || {});
  const custom = mergeById<CustomTaste>(base?.custom, local.custom || [], remote.custom || [], mine => mine);
  return { ...remote, ...local, ...lists, ...(Object.keys(reasons).length ? { reasons } : { reasons: undefined }), ...(custom.length ? { custom } : { custom: undefined }) };
}
function capPresets(presets: Preset[]): Preset[] {
  const count: Record<string, number> = {};
  return presets.filter(p => (count[p.category] = (count[p.category] || 0) + 1) <= 20).slice(0, 40);  // storage.ts decodeStore limits
}

/** This browser's store and the account's, brought together. `base` is the index of the copy both last agreed on, or null. */
export function mergeStores(base: StoreIndex | null, local: Store, remote: Store): Store {
  const b = base || undefined;
  const history = mergeById(b?.history, local.history, remote.history, (mine, theirs) => lastActivity(theirs) > lastActivity(mine) ? theirs : mine)
    .map((entry, order) => ({ entry, order })).sort((x, y) => lastActivity(y.entry) - lastActivity(x.entry) || x.order - y.order).map(x => x.entry).slice(0, 50);
  const presets = capPresets(mergeById<Preset>(b?.presets, local.presets || [], remote.presets || [], mine => mine));
  const tasteTypes = Object.fromEntries(CATEGORIES.map(c => [c, single(b?.tasteTypes[c], local.tasteTypes?.[c], remote.tasteTypes?.[c])]).filter(([, v]) => v !== undefined));
  const appearance = single(b?.appearance, local.appearance, remote.appearance);
  // A browser that never named itself takes the account's name on first contact.
  const name = !b && local.name === emptyStore().name ? remote.name : local.name === remote.name || !b || local.name !== b.name ? local.name : remote.name;
  const merged: Store = {
    ...remote, ...local, version: 2, name,
    profiles: Object.fromEntries(CATEGORIES.map(c => [c, mergeProfile(b?.profiles[c], local.profiles[c], remote.profiles[c])])) as Store['profiles'],
    favorites: mergeList(b?.favorites, local.favorites, remote.favorites), history,
  };
  if (presets.length || local.presets || remote.presets) merged.presets = presets; else delete merged.presets;
  if (Object.keys(tasteTypes).length) merged.tasteTypes = tasteTypes; else delete merged.tasteTypes;
  if (appearance) merged.appearance = appearance; else delete merged.appearance;
  return JSON.parse(JSON.stringify(merged));  // drops the undefined placeholders above
}

// ---- protocol ----

export type RemoteStore = { store: Store | null; version: number | null; unreadable?: boolean };
export type SyncApi = { fetch(): Promise<RemoteStore>; push(store: Store, baseVersion: number | null): Promise<{ version: number | null }> };
/** The account's copy cannot be used: uploading over it would destroy it, so the caller stops and says so. */
export class AccountDataError extends Error {
  constructor(message = '계정에 저장된 데이터를 읽지 못했어요. 페이지를 새로 고쳐 최신 버전으로 다시 시도해주세요.') { super(message); this.name = 'AccountDataError'; }
}
const refused = (error: unknown) => !!error && typeof error === 'object' && (error as { status?: number }).status === 409;
export type Synced = { store: Store; meta: SyncMeta; /** the store differs from the one passed in */ replaced: boolean };

/** Makes this browser and the account agree. `push` first tries to save on top of the version this browser knows and
 * only reads the account when that is refused; `pull` reads first. A refused save is never repeated blindly: the newer
 * copy is read and merged, then saved on top of the version just read. */
export async function syncStore(local: Store, meta: SyncMeta | null, userId: string, api: SyncApi, start: 'push' | 'pull' = 'push'): Promise<Synced> {
  const mine = meta && meta.userId === userId ? meta : null;
  if (start === 'push' && mine && mine.version !== null) {
    try { return { store: local, meta: metaFor(userId, (await api.push(local, mine.version)).version, local), replaced: false }; }
    catch (error) { if (!refused(error)) throw error; }
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const remote = await api.fetch();
    if (remote.unreadable) throw new AccountDataError();
    const unchanged = mine !== null && mine.version !== null && mine.version === remote.version;
    const merged = !remote.store || unchanged ? local : mergeStores(mine?.base ?? null, local, remote.store);
    const replaced = storeMark(merged) !== storeMark(local);
    if (remote.store && storeMark(merged) === storeMark(remote.store)) return { store: merged, meta: metaFor(userId, remote.version, merged), replaced };
    try { return { store: merged, meta: metaFor(userId, (await api.push(merged, remote.version)).version, merged), replaced }; }
    catch (error) { if (!refused(error)) throw error; }  // saved elsewhere again in between: read and merge once more
  }
  throw new Error('sync: the account kept changing');
}

/** What signing in does to this browser's data.
 * - The data is this account's (it synced here before): merged with the account's copy.
 * - The data is another account's (they signed out here): set aside, never uploaded; the account's copy or a fresh start.
 * - The data is nobody's (used without an account): it becomes the account's if the account has none, else it is set aside. */
export type LoginPlan = { store: Store; meta: SyncMeta; action: 'downloaded' | 'uploaded' | 'merged' | 'fresh'; keepAside: boolean };
export function planLogin(local: Store, meta: SyncMeta | null, remote: RemoteStore, account: Account): LoginPlan {
  if (remote.unreadable) throw new AccountDataError();
  // An account with nothing saved is remembered as an empty store at its version, so the first save needs no second read.
  const { id, name } = account.user, known = metaFor(id, remote.version, remote.store ?? emptyStore());
  const unchanged = meta !== null && meta.version !== null && meta.version === remote.version;
  const named = (store: Store): Store => ({ ...store, name: store.name && store.name !== emptyStore().name ? store.name : name });
  if (meta && meta.userId === id) {
    if (!remote.store) return { store: named(local), meta: known, action: 'uploaded', keepAside: false };
    const merged = named(unchanged ? local : mergeStores(meta.base, local, remote.store));
    return { store: merged, meta: known, action: storeMark(merged) === storeMark(remote.store) ? 'downloaded' : 'merged', keepAside: false };
  }
  if (remote.store) return { store: named(remote.store), meta: known, action: 'downloaded', keepAside: true };
  if (meta) return { store: named(emptyStore()), meta: known, action: 'fresh', keepAside: true };
  return { store: named(local), meta: known, action: 'uploaded', keepAside: false };
}
