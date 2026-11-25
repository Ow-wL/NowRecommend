import { apiJson, API_BASE_URL } from './client';
import { authHeaders } from './auth';

// 의견 보내기 (2026-11-18, server/app/routes/feedback.py): anyone can send one, without the account; an admin reads them.
export type FeedbackKind = 'praise' | 'problem' | 'idea' | 'other';
export type FeedbackStatus = 'new' | 'done';
export type FeedbackEntry = { id: string; createdAt: string; kind: FeedbackKind; message: string; contact: string | null; page: string; appVersion: string;
  /** Since 2026-11-26 (admin console inbox); an older server leaves them out. */ status?: FeedbackStatus; handledAt?: string | null; note?: string };
export const feedbackKinds: [FeedbackKind, string][] = [['problem', '불편하거나 안 돼요'], ['idea', '이런 게 있으면 좋겠어요'], ['praise', '좋았어요'], ['other', '기타']];
export const FEEDBACK_LIMIT = 1000;

const KINDS = feedbackKinds.map(([kind]) => kind);
const validEntry = (v: any): v is FeedbackEntry => !!v && typeof v.id === 'string' && typeof v.createdAt === 'string' && KINDS.includes(v.kind) && typeof v.message === 'string'
  && (v.contact === null || typeof v.contact === 'string') && typeof v.page === 'string' && typeof v.appVersion === 'string';
export type FeedbackPage = { feedback: FeedbackEntry[]; more: boolean; counts?: Record<FeedbackStatus, number> };
const validList = (v: any): v is FeedbackPage => !!v && Array.isArray(v.feedback) && v.feedback.every(validEntry) && typeof v.more === 'boolean';
const validCreated = (v: any): v is { id: string } => !!v && typeof v.id === 'string';
const nothing = (v: unknown): v is null => v === null;

/** The screen's name only (what follows #/ up to the next /), never a link's token. */
export function screenName(hash: string): string {
  const name = hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  return /^[a-z-]{1,24}$/.test(name) && !['reset', 'verify'].includes(name) ? name : '';
}
export const appVersion = (): string => String(import.meta.env.VITE_RELEASE ?? '').replace(/[^0-9A-Za-z.+-]/g, '').slice(0, 40);

type Options = { base?: string; fetchImpl?: typeof fetch };
export function sendFeedback(feedback: { kind: FeedbackKind; message: string; contact: string; page: string; appVersion: string }, { base = API_BASE_URL, fetchImpl }: Options = {}) {
  return apiJson('/api/feedback', validCreated, { base, fetchImpl, method: 'POST', body: feedback, timeoutMs: 15000 });
}
/** `after`: the last entry already shown; the page that follows it. */
export function fetchFeedback(token: string, after?: FeedbackEntry, { base = API_BASE_URL, fetchImpl, status = 'all', kind = 'all' }: Options & { status?: FeedbackStatus | 'all'; kind?: FeedbackKind | 'all' } = {}) {
  const query = new URLSearchParams({ ...(after ? { before: after.createdAt, beforeId: after.id } : {}), ...(status !== 'all' ? { status } : {}), ...(kind !== 'all' ? { kind } : {}) }).toString();
  return apiJson(`/api/admin/feedback${query ? `?${query}` : ''}`, validList, { base, fetchImpl, headers: authHeaders(token) });
}
export function updateFeedback(token: string, id: string, update: { status?: FeedbackStatus; note?: string }, { base = API_BASE_URL, fetchImpl }: Options = {}) {
  return apiJson(`/api/admin/feedback/${encodeURIComponent(id)}`, validEntry, { base, fetchImpl, method: 'POST', body: update, headers: authHeaders(token) });
}
export function deleteFeedback(token: string, id: string, { base = API_BASE_URL, fetchImpl }: Options = {}) {
  return apiJson(`/api/admin/feedback/${encodeURIComponent(id)}`, nothing, { base, fetchImpl, method: 'DELETE', headers: authHeaders(token) });
}
