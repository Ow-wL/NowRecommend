import { useSyncExternalStore } from 'react';
import { CATALOG_META, items as bundledItems, normalizeItem, type Item } from './data';
import { apiEnabled, apiJson, API_BASE_URL } from './api/client';

// The catalog the app recommends from: the bundled sample until the API catalog arrives (plans-rag.md §8).
export type Catalog = { items: Item[]; version: string; source: 'bundled' | 'server' };
const bundled: Catalog = { items: bundledItems, version: CATALOG_META.version, source: 'bundled' };
let current = bundled;
const listeners = new Set<() => void>();

export const getCatalog = () => current;
export function setCatalog(next: Catalog) { current = next; listeners.forEach(listener => listener()); }
export function resetCatalog() { setCatalog(bundled); }
export function subscribeCatalog(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export const useCatalog = () => useSyncExternalStore(subscribeCatalog, getCatalog);
export const findItem = (id: string, catalog: Catalog = current) => catalog.items.find(i => i.id === id);

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
export function validItem(i: any): i is Item {
  return !!i && typeof i.id === 'string' && ['food','music'].includes(i.category) && ['name','subtitle','description','emoji','color'].every(k => typeof i[k] === 'string')
    && strings(i.tags) && strings(i.ingredients) && (i.price === undefined || typeof i.price === 'string') && (i.cost === undefined || Number.isFinite(i.cost) && i.cost >= 0);
}
type CatalogResponse = { catalogVersion: string; items: Item[] };
export function validCatalogResponse(v: any): v is CatalogResponse {
  return !!v && typeof v.catalogVersion === 'string' && v.catalogVersion.length <= 100 && Array.isArray(v.items) && v.items.length > 0 && v.items.length <= 5000
    && v.items.every(validItem) && new Set(v.items.map((i: Item) => i.id)).size === v.items.length;
}

const CACHE_KEY = 'nowrecommend-catalog-v1';
type Options = { base?: string; fetchImpl?: typeof fetch; storage?: Pick<Storage, 'getItem' | 'setItem'> };
const tabStorage = () => { try { return sessionStorage; } catch { return undefined; } };

/** Restores this tab's cached API catalog, then refreshes it. Failures keep the current catalog and report false. */
export async function loadCatalog({ base = API_BASE_URL, fetchImpl, storage = tabStorage() }: Options = {}): Promise<boolean> {
  if (!apiEnabled(base)) return false;
  try {
    const cached = JSON.parse(storage?.getItem(CACHE_KEY) || 'null');
    if (validCatalogResponse(cached) && current.source === 'bundled') setCatalog({ items: cached.items.map(normalizeItem), version: cached.catalogVersion, source: 'server' });
  } catch { /* A broken cache only costs the faster start. */ }
  try {
    const fresh = await apiJson('/api/catalog', validCatalogResponse, { base, fetchImpl, timeoutMs: 8000 });
    // Servers deployed before the price removal still send price/cost and a price subtitle; normalizeItem drops them.
    if (fresh.catalogVersion !== current.version || current.source !== 'server') setCatalog({ items: fresh.items.map(normalizeItem), version: fresh.catalogVersion, source: 'server' });
    try { storage?.setItem(CACHE_KEY, JSON.stringify(fresh)); } catch { /* Quota or privacy mode: keep the in-memory copy. */ }
    return true;
  } catch {
    return false;
  }
}
