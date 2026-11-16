import type { AccountUser } from './api/auth';

// The signed-in account of this browser (token + who), separate from the Store so a backup never carries a token.
const KEY = 'nowrecommend-auth-v1';
export type Account = { token: string; user: AccountUser };
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
const storage = (): Storage | undefined => { try { return localStorage; } catch { return undefined; } };

export function readAccount(store: Storage | undefined = storage()): Account | null {
  try {
    const v = JSON.parse(store?.getItem(KEY) || 'null');
    return v && typeof v.token === 'string' && v.token && v.user && typeof v.user.id === 'string' && typeof v.user.email === 'string' && typeof v.user.name === 'string' ? { token: v.token, user: v.user } : null;
  } catch { return null; }
}
export function writeAccount(account: Account | null, store: Storage | undefined = storage()): boolean {
  try { if (account) store?.setItem(KEY, JSON.stringify(account)); else store?.removeItem(KEY); return true; } catch { return false; }
}

/** The browser's data from before a login that replaced it, kept under `nowrecommend-prototype-v1-before-login` so nothing
 * is lost. What a login does to the data is decided in src/sync.ts (planLogin). */
export function keepLocalCopy(raw: string | null, store: Storage | undefined = storage()) {
  try { if (raw) store?.setItem('nowrecommend-prototype-v1-before-login', raw); } catch { /* best effort */ }
}
