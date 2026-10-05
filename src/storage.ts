import { emptyStore, type Store } from './domain';
const KEY = 'nowrecommend-prototype-v1';
export function readStore(): Store {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (value?.version === 1 && typeof value.name === 'string' && ['food', 'music'].every(c => ['selected', 'tags', 'disliked'].every(k => Array.isArray(value.profiles?.[c]?.[k]) && value.profiles[c][k].every((v: unknown) => typeof v === 'string'))) && Array.isArray(value.favorites) && value.favorites.every((v: unknown) => typeof v === 'string') && Array.isArray(value.history) && value.history.every((h: any) => typeof h.id === 'string' && typeof h.date === 'string' && ['food', 'music'].includes(h.category) && typeof h.raw === 'string' && Array.isArray(h.resultIds) && Array.isArray(h.conditions?.tags) && Array.isArray(h.conditions?.excluded) && (h.conditions.maxPrice === null || typeof h.conditions.maxPrice === 'number'))) return value;
  } catch { /* A damaged browser store should not prevent the demo from opening. */ }
  return emptyStore();
}
export function writeStore(store: Store): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(store)); return true; } catch { return false; }
}
