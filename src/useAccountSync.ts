import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { keepLocalCopy, readAccount, type Account } from './account';
import type { Store } from './domain';
import { ApiError } from './api/client';
import { fetchMe, fetchRemoteStore, pushRemoteStore } from './api/auth';
import { writeStore } from './storage';
import { AccountDataError, indexStore, mergeStores, parseSyncMeta, planLogin, storeMark, syncStore, type SyncApi, type SyncMeta } from './sync';

export type SyncState = 'idle' | 'saving' | 'saved' | 'failed';
const SAVE_DELAY = 1500;       // after the last change
const RECHECK_AFTER = 60_000;  // a tab that comes back to the front asks whether another device saved meanwhile

/** Keeps the signed-in account's copy and this browser's store in agreement (protocol and merge rules: src/sync.ts).
 * The account's copy is read when the app opens, when a save is refused and when the tab comes back; a save always names
 * the version it was built on. `paused` stops everything (the local store could not be read, so it must not be uploaded).
 *
 * Each tab remembers its own agreement with the account (`meta`): another tab's agreement says nothing about the store
 * this tab holds, and saving this tab's store on top of it would silently drop what the other tab added. The store and
 * the agreement are one localStorage record (src/storage.ts), read together when the tab opens (`savedAgreement`) and
 * written together, so the pair always comes from one tab at one moment. */
export function useAccountSync({ account, store, setStore, savedAgreement, paused, onExpired, notify }: {
  account: Account | null; store: Store; setStore: Dispatch<SetStateAction<Store>>; savedAgreement: unknown; paused: boolean; onExpired: () => void; notify: (message: string) => void;
}) {
  const [state, setState] = useState<SyncState>('idle');
  const latest = useRef({ account, store, paused, onExpired, notify });
  latest.current = { account, store, paused, onExpired, notify };
  const [first] = useState(() => parseSyncMeta(savedAgreement));
  const meta = useRef<SyncMeta | null>(first);
  const known = () => meta.current;
  /** Saves the store and the agreement that describes it, as one record. */
  const persist = (next: Store, agreed: SyncMeta | null) => { meta.current = agreed; if (!latest.current.paused) writeStore(next, agreed); };
  const running = useRef(false), queued = useRef<'push' | 'pull' | null>(null), failureTold = useRef(false), checkedAt = useRef(0), skipPull = useRef(false);

  /** One sync at a time; a request made meanwhile runs right after. True when the account and this tab agreed at the end. */
  const run = useCallback(async (start: 'push' | 'pull'): Promise<boolean> => {
    if (running.current) { queued.current = start === 'pull' || queued.current === 'pull' ? 'pull' : 'push'; return false; }
    running.current = true;
    try {
      for (let mode: 'push' | 'pull' | null = start; mode; mode = queued.current) {
        queued.current = null;
        const { account: who, store: snapshot, paused: stopped } = latest.current;
        if (!who || stopped) return false;
        const still = () => latest.current.account?.token === who.token;
        const agreed = known();
        if (mode === 'push' && agreed?.userId === who.user.id && agreed.mark === storeMark(snapshot)) { setState(s => s === 'saving' ? 'saved' : s); continue; }
        setState('saving');
        const api: SyncApi = { fetch: () => fetchRemoteStore(who.token), push: (next, version) => pushRemoteStore(who.token, next, version) };
        let result: { store: Store; meta: SyncMeta; replaced: boolean; held?: true }, foreign = false;
        try {
          if (agreed && agreed.userId !== who.user.id) {
            // The data here is another account's (left by a session that ended oddly): it is set aside and replaced,
            // never merged into this account, exactly as the login form does.
            const plan = planLogin(snapshot, agreed, await api.fetch(), who);
            result = { store: plan.store, meta: plan.meta, replaced: true }; foreign = true;
          } else result = await syncStore(snapshot, agreed, who.user.id, api, mode);
        } catch (error) {
          if (!still()) continue;  // signed out or switched meanwhile: this failure is nobody's here
          if (error instanceof ApiError && error.status === 401) { latest.current.onExpired(); return false; }
          setState('failed');
          if (!failureTold.current) {
            failureTold.current = true;
            latest.current.notify(error instanceof AccountDataError ? error.message : '계정에 저장하지 못했어요. 이 브라우저에는 남아 있고, 내 계정에서 다시 저장할 수 있어요.');
          }
          return false;
        }
        if (!still()) continue;  // the answer belongs to an account that is no longer signed in here: not remembered
        checkedAt.current = Date.now();
        failureTold.current = false;
        setState(result.held ? 'idle' : 'saved');  // held: waiting for the answer about health words, nothing was saved
        const seen = latest.current.store;
        if (foreign) {
          // Whatever was changed while the request was out was changed in the other account's data: it goes aside with
          // the rest and is not replayed on this account's store.
          keepLocalCopy(JSON.stringify(seen));
          persist(result.store, result.meta);
          latest.current = { ...latest.current, store: result.store };
          setStore(result.store);
          queued.current = null;
          break;
        }
        if (!result.replaced) { persist(seen, result.meta); continue; }
        // Changes made while the request was out are replayed on the merged store; the store effect then saves them.
        const merged = result.store, next = seen === snapshot ? merged : mergeStores(indexStore(snapshot), seen, merged);
        persist(next, result.meta);
        latest.current = { ...latest.current, store: next };  // until the next render: a sync started in between must not save the old store over the merge
        setStore(current => current === seen ? next : mergeStores(indexStore(seen), current, next));
        queued.current = null;
        break;
      }
      return true;
    } finally { running.current = false; }
  }, [setStore]);

  const token = account?.token;
  // Opening the app (or signing in elsewhere than the login form): read the account's copy before anything is uploaded.
  useEffect(() => {
    if (!token) { setState('idle'); return; }
    if (paused) return;
    if (skipPull.current) { skipPull.current = false; checkedAt.current = Date.now(); return; }
    void run('pull');
  }, [token, paused, run]);
  // A change is saved 1.5s after the last one. Nothing is sent while the store is what the account already has.
  useEffect(() => {
    if (!account || paused) return;
    const agreed = known();
    if (agreed?.userId === account.user.id && agreed.mark === storeMark(store)) return;
    setState('saving');
    const timer = setTimeout(() => void run('push'), SAVE_DELAY);
    return () => clearTimeout(timer);
  }, [store, account, paused, run]);  // eslint-disable-line react-hooks/exhaustive-deps
  // A tab left open: when it comes back, a cheap version check decides whether to read the account's copy.
  useEffect(() => {
    if (!token || paused) return;
    const check = () => {
      if (document.visibilityState !== 'visible' || Date.now() - checkedAt.current < RECHECK_AFTER) return;
      checkedAt.current = Date.now();
      fetchMe(token).then(me => { if (me.storeVersion !== undefined && me.storeVersion !== known()?.version) void run('pull'); }).catch(() => { /* the next save notices */ });
    };
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, [token, paused, run]);  // eslint-disable-line react-hooks/exhaustive-deps
  // Another tab signed in, out or into another account: this tab starts again from what that tab saved, instead of going
  // on with a store and an account that no longer belong together.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== 'nowrecommend-auth-v1') return;
      if ((readAccount()?.token ?? null) !== (latest.current.account?.token ?? null)) window.location.reload();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return {
    state,
    /** After a failure: read the account's copy and save again. */
    retry: () => { void run('pull'); },
    /** What this tab last agreed on with an account, if anything (also tells whose the data in this browser is). */
    agreement: known,
    /** The login form read the account's copy itself (planLogin): take its result and skip the read on sign-in once. */
    adopt: (next: Store, agreed: SyncMeta) => { skipPull.current = true; persist(next, agreed); },
    /** The data in this browser is nobody's from now on (the account was deleted, or the browser was emptied). */
    forget: (save = true) => { if (save) persist(latest.current.store, null); else meta.current = null; },  // `false`: the caller is about to replace the store anyway
    /** Saves what is not saved yet. True only when the account has exactly what this tab holds now, edits made while
     * saving included (asked before this browser's data is cleared). */
    flush: async (): Promise<boolean> => {
      for (let round = 0; round < 4; round++) {
        for (let i = 0; i < 80 && running.current; i++) await new Promise(resolve => setTimeout(resolve, 250));
        if (!await run('push')) { if (running.current) continue; return false; }
        await new Promise(resolve => setTimeout(resolve, 0));  // lets a merged store reach the screen before it is compared
        const who = latest.current.account, agreed = known();
        if (who && agreed?.userId === who.user.id && agreed.mark === storeMark(latest.current.store)) return true;
      }
      return false;
    },
  };
}
