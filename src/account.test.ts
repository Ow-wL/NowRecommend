import { describe, expect, it } from 'vitest';
import { readAccount, sessionHeaders, writeAccount } from './account';
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
  it('sends the token with requests the server counts per caller, and nothing for a guest', () => {
    const storage = memory();
    expect(sessionHeaders(storage)).toEqual({});
    writeAccount(account, storage);
    expect(sessionHeaders(storage)).toEqual({ Authorization: 'Bearer t.sig' });
  });
});

describe('auth API', () => {
  const json = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });
  it('sends credentials and returns the session', async () => {
    let seen: any;
    const fetchImpl = (async (url: string, init: RequestInit) => { seen = [url, init]; return new Response(JSON.stringify({ token: 't', user: account.user, hasStore: false }), { status: 201 }); }) as typeof fetch;
    const session = await signup(' a@b.co ', 'password1', '주형', { termsVersion: '2026-11-17', agreeTerms: true, agreePrivacy: true, adult: true }, { base: 'http://api.test', fetchImpl });
    expect(session.user.name).toBe('주형');
    expect(seen[0]).toBe('http://api.test/api/auth/signup');
    expect(JSON.parse(seen[1].body)).toEqual({ email: 'a@b.co', password: 'password1', name: '주형', termsVersion: '2026-11-17', agreeTerms: true, agreePrivacy: true, adult: true });  // what was agreed to goes with it
  });
  it('reads the synced store with the bearer token and tells an unreadable blob from none', async () => {
    let headers: any;
    const fetchImpl = (async (_: string, init: RequestInit) => { headers = init.headers; return new Response(JSON.stringify({ store: { version: 99 }, updatedAt: '2026-11-02T00:00:00Z' })); }) as typeof fetch;
    const answer = await fetchRemoteStore('tok', { base: 'http://api.test', fetchImpl });
    expect(headers.Authorization).toBe('Bearer tok');
    // A blob this build cannot read is not "no store": the caller must not upload over it.
    expect(answer).toEqual({ store: null, updatedAt: '2026-11-02T00:00:00Z', version: null, unreadable: true });  // and a server that names no version
    const good = await fetchRemoteStore('tok', { base: 'http://api.test', fetchImpl: json({ store: emptyStore(), updatedAt: null, version: 7 }) });
    expect(good).toMatchObject({ version: 7, unreadable: false });
    expect(good.store?.version).toBe(2);
    const empty = await fetchRemoteStore('tok', { base: 'http://api.test', fetchImpl: json({ store: null, updatedAt: null, version: 0 }) });
    expect(empty).toMatchObject({ store: null, unreadable: false });
  });
  it('uploads with PUT and surfaces the server detail on failure', async () => {
    let method = '', body: any;
    const fetchImpl = (async (_: string, init: RequestInit) => { method = init.method!; body = JSON.parse(init.body as string); return new Response(JSON.stringify({ updatedAt: 'now', bytes: 12, version: 4 })); }) as typeof fetch;
    expect(await pushRemoteStore('tok', emptyStore(), 3, { base: 'http://api.test', fetchImpl })).toEqual({ updatedAt: 'now', bytes: 12, version: 4 });
    expect(method).toBe('PUT');
    expect(body.baseVersion).toBe(3);
    // A server without versions: no baseVersion is sent, and the answer says so with null.
    const old = (async (_: string, init: RequestInit) => { body = JSON.parse(init.body as string); return new Response(JSON.stringify({ updatedAt: 'now', bytes: 12 })); }) as typeof fetch;
    expect((await pushRemoteStore('tok', emptyStore(), null, { base: 'http://api.test', fetchImpl: old })).version).toBeNull();
    expect('baseVersion' in body).toBe(false);
    // The save another device beat: 409, which src/sync.ts answers by reading and merging.
    await expect(pushRemoteStore('tok', emptyStore(), 3, { base: 'http://api.test', fetchImpl: json({ detail: '다른 기기에서 먼저 저장했어요.' }, 409) })).rejects.toMatchObject({ status: 409 });
    const failing = json({ detail: '이미 가입된 이메일이에요. 로그인해주세요.' }, 409);
    await expect(signup('a@b.co', 'password1', 'x', { termsVersion: '2026-11-17', agreeTerms: true, agreePrivacy: true, adult: true }, { base: 'http://api.test', fetchImpl: failing })).rejects.toMatchObject({ status: 409, message: '이미 가입된 이메일이에요. 로그인해주세요.' });
  });
  it('explains failures in the form’s words', () => {
    expect(authErrorMessage(new ApiError('http', 'x', 401), 'login')).toBe('이메일 또는 비밀번호가 맞지 않아요.');
    expect(authErrorMessage(new ApiError('http', 'x', 503), 'login')).toContain('계정 기능이 설정되지 않았어요');
    expect(authErrorMessage(new ApiError('http', 'x', 409), 'signup')).toContain('이미 가입된');
    expect(authErrorMessage(new ApiError('offline', 'x'), 'signup')).toContain('연결하지 못했어요');
    expect(authErrorMessage(new Error('boom'), 'login')).toContain('다시 시도');
    // 2026-11-17: the reset form's own words
    expect(authErrorMessage(new ApiError('http', 'x', 400), 'reset')).toContain('링크가 만료됐거나');
    expect(authErrorMessage(new ApiError('http', 'x', 503), 'forgot')).toContain('메일로 비밀번호를 다시 정할 수 없어요');
    expect(authErrorMessage(new ApiError('http', '오늘은 더 요청할 수 없어요.', 429), 'forgot')).toBe('오늘은 더 요청할 수 없어요.');
  });
});
