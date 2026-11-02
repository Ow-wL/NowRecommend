import { describe, expect, it } from 'vitest';
import { mergeOnLogin, readAccount, writeAccount } from './account';
import { authErrorMessage, fetchRemoteStore, pushRemoteStore, signup } from './api/auth';
import { ApiError } from './api/client';
import { emptyStore } from './domain';

const memory = () => { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } }; };
const account = { token: 't.sig', user: { id: 'u1', email: 'a@b.co', name: '주형' } };

describe('account storage', () => {
  it('round-trips the signed-in account and clears it on logout', () => {
    const storage = memory();
    expect(writeAccount(account, storage)).toBe(true);
    expect(readAccount(storage)).toEqual(account);
    expect(writeAccount(null, storage)).toBe(true);
    expect(readAccount(storage)).toBeNull();
    storage.setItem('nowrecommend-auth-v1', '{"token":""}');
    expect(readAccount(storage)).toBeNull();
  });
});

describe('store merge on login', () => {
  const local = { ...emptyStore(), favorites: ['f01'] };
  it('takes the account copy when there is one', () => {
    const remote = { ...emptyStore(), name: '', favorites: ['m01'] };
    expect(mergeOnLogin(local, remote, account)).toEqual({ store: { ...remote, name: '주형' }, action: 'downloaded' });
  });
  it('uploads the local data for a fresh account, naming it after the account', () => {
    expect(mergeOnLogin(local, null, account)).toEqual({ store: { ...local, name: '주형' }, action: 'uploaded' });
    expect(mergeOnLogin({ ...local, name: '지은' }, null, account).store.name).toBe('지은');
  });
});

describe('auth API', () => {
  const json = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });
  it('sends credentials and returns the session', async () => {
    let seen: any;
    const fetchImpl = (async (url: string, init: RequestInit) => { seen = [url, init]; return new Response(JSON.stringify({ token: 't', user: account.user, hasStore: false }), { status: 201 }); }) as typeof fetch;
    const session = await signup(' a@b.co ', 'password1', '주형', { base: 'http://api.test', fetchImpl });
    expect(session.user.name).toBe('주형');
    expect(seen[0]).toBe('http://api.test/api/auth/signup');
    expect(JSON.parse(seen[1].body)).toEqual({ email: 'a@b.co', password: 'password1', name: '주형' });
  });
  it('reads the synced store with the bearer token and ignores an unreadable blob', async () => {
    let headers: any;
    const fetchImpl = (async (_: string, init: RequestInit) => { headers = init.headers; return new Response(JSON.stringify({ store: { version: 99 }, updatedAt: '2026-11-02T00:00:00Z' })); }) as typeof fetch;
    const answer = await fetchRemoteStore('tok', { base: 'http://api.test', fetchImpl });
    expect(headers.Authorization).toBe('Bearer tok');
    expect(answer).toEqual({ store: null, updatedAt: '2026-11-02T00:00:00Z' });
    const good = await fetchRemoteStore('tok', { base: 'http://api.test', fetchImpl: json({ store: emptyStore(), updatedAt: null }) });
    expect(good.store?.version).toBe(2);
    const empty = await fetchRemoteStore('tok', { base: 'http://api.test', fetchImpl: json({ store: null, updatedAt: null }) });
    expect(empty.store).toBeNull();
  });
  it('uploads with PUT and surfaces the server detail on failure', async () => {
    let method = '';
    const fetchImpl = (async (_: string, init: RequestInit) => { method = init.method!; return new Response(JSON.stringify({ updatedAt: 'now', bytes: 12 })); }) as typeof fetch;
    expect(await pushRemoteStore('tok', emptyStore(), { base: 'http://api.test', fetchImpl })).toEqual({ updatedAt: 'now', bytes: 12 });
    expect(method).toBe('PUT');
    const failing = json({ detail: '이미 가입된 이메일이에요. 로그인해주세요.' }, 409);
    await expect(signup('a@b.co', 'password1', 'x', { base: 'http://api.test', fetchImpl: failing })).rejects.toMatchObject({ status: 409, message: '이미 가입된 이메일이에요. 로그인해주세요.' });
  });
  it('explains failures in the form’s words', () => {
    expect(authErrorMessage(new ApiError('http', 'x', 401), 'login')).toBe('이메일 또는 비밀번호가 맞지 않아요.');
    expect(authErrorMessage(new ApiError('http', 'x', 503), 'login')).toContain('계정 기능이 설정되지 않았어요');
    expect(authErrorMessage(new ApiError('http', 'x', 409), 'signup')).toContain('이미 가입된');
    expect(authErrorMessage(new ApiError('offline', 'x'), 'signup')).toContain('연결하지 못했어요');
    expect(authErrorMessage(new Error('boom'), 'login')).toContain('다시 시도');
  });
});
