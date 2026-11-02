import type { Item } from './data';
import { validItem } from './catalog';

// Items the server named that are not in the reviewed catalog (AI picks, src/api/recommend.ts meta.engine 'ai').
// Favourites, tastes and exclusions store ids only, so the browser keeps a copy of each such item to show them later.
// Separate from the main store (not backed up, not synced): the server can always name the item again by its id.
const KEY = 'nowrecommend-known-items-v1';
const LIMIT = 400;
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
const storage = (): Storage | undefined => { try { return localStorage; } catch { return undefined; } };
let cache: Map<string, Item> | null = null;

function load(store: Storage | undefined = storage()): Map<string, Item> {
  if (cache) return cache;
  cache = new Map();
  try {
    const value = JSON.parse(store?.getItem(KEY) || '[]');
    if (Array.isArray(value)) for (const item of value) if (validItem(item)) cache.set(item.id, item);
  } catch { /* a damaged cache only loses the names of past AI picks */ }
  return cache;
}

/** Remembers server items absent from `catalog`; returns false when the browser refused to store them. */
export function rememberItems(items: Item[], catalog: Item[], store: Storage | undefined = storage()): boolean {
  const known = load(store);
  const fresh = items.filter(i => !catalog.some(c => c.id === i.id));
  if (!fresh.length) return true;
  for (const item of fresh) { known.delete(item.id); known.set(item.id, item); }  // newest last
  while (known.size > LIMIT) known.delete(known.keys().next().value!);
  try { store?.setItem(KEY, JSON.stringify([...known.values()])); return true; } catch { return false; }
}

export const knownItem = (id: string, store: Storage | undefined = storage()): Item | undefined => load(store).get(id);
export const knownItems = (store: Storage | undefined = storage()): Item[] => [...load(store).values()];
export function resetKnownItems() { cache = null; }
/** A catalog item, or a remembered AI pick with that id. */
export const resolveItem = (catalog: Item[], id: string): Item | undefined => catalog.find(i => i.id === id) || knownItem(id);
export const isAiPick = (id: string) => id.startsWith('ai-');
