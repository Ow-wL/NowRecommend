import { apiJson, ApiError, API_BASE_URL } from './client';
import { decodeStore } from '../storage';
import { AccountDataError } from '../sync';
import type { Store } from '../domain';

// Accounts (2026-11-02, server/app/routes/auth.py). Tokens are opaque strings the browser stores (src/account.ts) and
// sends as `Authorization: Bearer`. The synced store is the whole browser Store; the server never interprets it.
export type AccountUser = { id: string; email: string; name: string; createdAt?: string | null; isAdmin?: boolean };
export type AuthSession = { token: string; user: AccountUser; hasStore: boolean };

const user = (v: any): v is AccountUser => !!v && typeof v.id === 'string' && typeof v.email === 'string' && typeof v.name === 'string';
const validSession = (v: any): v is AuthSession => !!v && typeof v.token === 'string' && v.token.length > 0 && user(v.user) && typeof v.hasStore === 'boolean';
const validMe = (v: any): v is { user: AccountUser; hasStore: boolean; storeUpdatedAt: string | null; storeVersion?: number } => !!v && user(v.user) && typeof v.hasStore === 'boolean' && (v.storeVersion === undefined || Number.isInteger(v.storeVersion));
const validRemoteStore = (v: any): v is { store: unknown; updatedAt: string | null; version?: number } => !!v && 'store' in v && (v.updatedAt === null || typeof v.updatedAt === 'string') && (v.version === undefined || Number.isInteger(v.version));
const validSaved = (v: any): v is { updatedAt: string; bytes: number; version?: number } => !!v && typeof v.updatedAt === 'string' && Number.isFinite(v.bytes) && (v.version === undefined || Number.isInteger(v.version));
const nothing = (v: unknown): v is null => v === null;

type Options = { base?: string; fetchImpl?: typeof fetch };
export const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}` });

/** `consent`: the version of the terms and privacy policy the person agreed to on the form, and that they said they are of age. */
export type SignupConsent = { termsVersion: string; agreeTerms: boolean; agreePrivacy: boolean; adult: boolean };
/** What sign-up answers when the address must be confirmed first (2026-11-18): no session; a mail with a link was sent
 * (`sent`), or could not be (`failed`: logging in later mails it again). */
export type SignupPending = { verify: 'sent' | 'failed'; email: string };
const validPending = (v: any): v is SignupPending => !!v && (v.verify === 'sent' || v.verify === 'failed') && typeof v.email === 'string';
const validSignup = (v: any): v is AuthSession | SignupPending => validSession(v) || validPending(v);
export const pendingSignup = (answer: AuthSession | SignupPending): answer is SignupPending => 'verify' in answer;
export function signup(email: string, password: string, name: string, consent: SignupConsent, { base = API_BASE_URL, fetchImpl }: Options = {}) {
  return apiJson('/api/auth/signup', validSignup, { base, fetchImpl, method: 'POST', body: { email: email.trim(), password, name: name.trim(), ...consent }, timeoutMs: 20000 });
}
/** Confirms the address from the sign-up mail's link. It does not sign in: the person logs in next. */
export function confirmEmail(token: string, { base = API_BASE_URL, fetchImpl }: Options = {}) {
  return apiJson('/api/auth/verify', (v: any): v is { verified: true; email: string } => !!v && v.verified === true && typeof v.email === 'string',
    { base, fetchImpl, method: 'POST', body: { token }, timeoutMs: 15000 });
}
export function login(email: string, password: string, { base = API_BASE_URL, fetchImpl }: Options = {}) {
  return apiJson('/api/auth/login', validSession, { base, fetchImpl, method: 'POST', body: { email: email.trim(), password }, timeoutMs: 20000 });
}
export function fetchMe(token: string, { base = API_BASE_URL, fetchImpl }: Options = {}) {
  return apiJson('/api/auth/me', validMe, { base, fetchImpl, headers: authHeaders(token) });
}
/** The account's synced store with its version, or `store: null` when the account has none yet. A stored blob this build
 * cannot read is `unreadable`, never "none": treating it as empty would let the next upload destroy it (2026-11-16).
 * A server from before store versions answers without one: `version` is then null, and src/sync.ts reads and merges before
 * every save there, because that server cannot refuse a stale one. */
export async function fetchRemoteStore(token: string, { base = API_BASE_URL, fetchImpl }: Options = {}): Promise<{ store: Store | null; updatedAt: string | null; version: number | null; unreadable: boolean }> {
  const answer = await apiJson('/api/me/store', validRemoteStore, { base, fetchImpl, headers: authHeaders(token), timeoutMs: 15000 });
  const none = answer.store === null || answer.store === undefined;
  const store = none ? null : decodeStore(JSON.stringify(answer.store));
  return { store, updatedAt: answer.updatedAt, version: answer.version ?? null, unreadable: !none && store === null };
}
/** Saves the store on top of `baseVersion`. The server answers 409 when another device saved since then (see src/sync.ts). */
export async function pushRemoteStore(token: string, store: Store, baseVersion: number | null, { base = API_BASE_URL, fetchImpl }: Options = {}) {
  const saved = await apiJson('/api/me/store', validSaved, { base, fetchImpl, method: 'PUT', body: baseVersion === null ? { store } : { store, baseVersion }, headers: authHeaders(token), timeoutMs: 20000 });
  return { ...saved, version: saved.version ?? null };
}
export function deleteAccount(token: string, password: string, { base = API_BASE_URL, fetchImpl }: Options = {}) {
  return apiJson('/api/auth/delete', nothing, { base, fetchImpl, method: 'POST', body: { password }, headers: authHeaders(token), timeoutMs: 15000 });
}

// Passwords and sessions (2026-11-17, server/app/routes/auth.py).
const validSent = (v: any): v is { sent: boolean } => !!v && v.sent === true;
/** A new password ends every other session of the account; the answer carries this browser's new token. */
export function changePassword(token: string, currentPassword: string, newPassword: string, { base = API_BASE_URL, fetchImpl }: Options = {}) {
  return apiJson('/api/auth/password', validSession, { base, fetchImpl, method: 'POST', body: { currentPassword, newPassword }, headers: authHeaders(token), timeoutMs: 15000 });
}
/** Ends every session of the account, this one included. */
export function logoutEverywhere(token: string, { base = API_BASE_URL, fetchImpl }: Options = {}) {
  return apiJson('/api/auth/logout-all', nothing, { base, fetchImpl, method: 'POST', headers: authHeaders(token), timeoutMs: 15000 });
}
/** Asks for the reset mail. The server answers the same whether or not the address has an account. */
export function requestReset(email: string, { base = API_BASE_URL, fetchImpl }: Options = {}) {
  return apiJson('/api/auth/reset/request', validSent, { base, fetchImpl, method: 'POST', body: { email: email.trim() }, timeoutMs: 20000 });
}
/** Sets the new password from the mailed link and signs this browser in. */
export function confirmReset(token: string, password: string, { base = API_BASE_URL, fetchImpl }: Options = {}) {
  return apiJson('/api/auth/reset/confirm', validSession, { base, fetchImpl, method: 'POST', body: { token, password }, timeoutMs: 15000 });
}

/** What the form should say for a failed sign-up, login or password reset. */
export function authErrorMessage(error: unknown, mode: 'login' | 'signup' | 'forgot' | 'reset' | 'verify'): string {
  if (error instanceof AccountDataError) return error.message;
  if (!(error instanceof ApiError)) return '요청을 보내지 못했어요. 잠시 후 다시 시도해주세요.';
  if (error.kind === 'offline') return '서버에 연결하지 못했어요. 네트워크를 확인해주세요.';
  if (error.kind === 'timeout') return '서버 응답이 늦어요. 잠시 후 다시 시도해주세요.';
  if (error.status === 503) {
    if (mode === 'forgot') return '지금은 메일로 비밀번호를 다시 정할 수 없어요. 잠시 후 다시 시도해주세요.';
    if (mode === 'signup' && error.message.includes('메일')) return '지금은 가입 확인 메일을 보낼 수 없어 가입을 받지 못해요. 잠시 후 다시 시도해주세요.';
    return '이 서버에는 계정 기능이 설정되지 않았어요. 로그인 없이 계속 쓸 수 있어요.';
  }
  // The server's own sentence: it tells a busy minute from an account whose password was got wrong too often (and what to do then).
  if (error.status === 429) return error.message || '시도가 너무 많아요. 잠시 후 다시 시도해주세요.';
  if (mode === 'reset') return error.status === 400 ? '링크가 만료됐거나 이미 사용됐어요. 메일을 다시 받아주세요.' : error.status === 422 ? '비밀번호는 8자 이상이어야 해요.' : error.message || '비밀번호를 바꾸지 못했어요.';
  if (mode === 'forgot') return error.status === 422 ? '이메일 형식을 확인해주세요.' : error.message || '요청을 처리하지 못했어요.';
  if (mode === 'verify') return error.status === 400 || error.status === 422 ? '링크가 만료됐거나 더 이상 쓸 수 없어요. 로그인하면 확인 메일을 다시 보내 드려요.' : error.message || '이메일을 확인하지 못했어요.';
  // The right password for an account whose address is not confirmed yet: the server says whether it mailed the link again.
  if (error.status === 403 && mode === 'login') return error.message || '이메일 확인이 아직이에요. 메일함을 확인해주세요.';
  if (error.status === 401) return '이메일 또는 비밀번호가 맞지 않아요.';
  if (error.status === 409) return error.message.includes('약관') || error.message.includes('가입 신청') ? error.message : '이미 가입된 이메일이에요. 로그인해주세요.';  // the documents changed since the form was opened
  if (error.status === 422) return mode === 'signup' ? '이메일 형식, 8자 이상의 비밀번호, 16자 이내의 이름과 약관 동의를 확인해주세요.' : '이메일 형식과 비밀번호를 확인해주세요.';
  return error.message || '요청을 처리하지 못했어요.';
}
