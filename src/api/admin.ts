import { apiJson, API_BASE_URL } from './client';
export { ADMIN_DENIED } from './client';
import { authHeaders } from './auth';

// The admin console's own routes (server/app/routes/admin.py, 2026-11-26). Every one needs an admin account; the server
// checks on each request. Answers are checked for their shape only as far as the screens rely on it.
type Options = { base?: string; fetchImpl?: typeof fetch };
const obj = (v: any) => !!v && typeof v === 'object';
const get = <T,>(path: string, valid: (v: any) => v is T, token: string, { base = API_BASE_URL, fetchImpl }: Options = {}) =>
  apiJson(path, valid, { base, fetchImpl, headers: authHeaders(token), timeoutMs: 15000 });
const post = <T,>(path: string, body: unknown, valid: (v: any) => v is T, token: string, { base = API_BASE_URL, fetchImpl }: Options = {}) =>
  apiJson(path, valid, { base, fetchImpl, method: 'POST', body, headers: authHeaders(token), timeoutMs: 15000 });

export type Quota = { key: string; label: string; used: number; limit: number };
export type Kpi = { current: number; previous: number };
export type Overview = {
  days: number; series: { day: string; counts: Record<string, number> }[]; kpis: Record<'visit' | 'recommend' | 'signup' | 'login' | 'ai' | 'clientError' | 'feedback' | 'report', Kpi>;
  trackedSince: Record<string, string>;
  accounts: { total: number; confirmed: number; suspended: number; admins: number; newInPeriod: number; loggedInWeek: number };
  todo: { openReports: number; newFeedback: number; clientErrorsToday: number }; quotas: Quota[];
};
const validOverview = (v: any): v is Overview => obj(v) && Array.isArray(v.series) && obj(v.kpis) && obj(v.accounts) && obj(v.todo) && Array.isArray(v.quotas);
export const fetchOverview = (token: string, days: number, o?: Options) => get(`/api/admin/overview?days=${days}`, validOverview, token, o);

export type MemberFilter = 'all' | 'confirmed' | 'unconfirmed' | 'admin' | 'suspended' | 'withData';
export type MemberSort = 'created' | 'login' | 'email';
export type MemberRow = { id: string; email: string; name: string; createdAt: string | null; lastLoginAt: string | null; verified: boolean; isAdmin: boolean; suspended: boolean; hasData: boolean };
export type MemberPage = { members: MemberRow[]; total: number; page: number; size: number };
export type AuditEntry = { id: number; at: string; actor: string; action: string; targetType: string; targetId: string; reason: string; detail: Record<string, unknown> };
export type Member = MemberRow & {
  verifiedAt: string | null; suspendedAt: string | null; suspendedReason: string | null; termsVersion: string | null; termsAgreedAt: string | null;
  store: { bytes: number; version: number; updatedAt: string | null; counts: Record<string, number> };
  aiToday: { used: number; limit: number }; reports: Record<'open' | 'resolved' | 'dismissed', number>; actions: AuditEntry[]; mailed?: boolean;
  /** The owner account (ADMIN_OWNER_ID); `canSetAdmin`: the one looking is the owner and this is someone else (2026-11-26). */
  owner?: boolean; canSetAdmin?: boolean;
};
const validMemberPage = (v: any): v is MemberPage => obj(v) && Array.isArray(v.members) && Number.isInteger(v.total);
const validMember = (v: any): v is Member => obj(v) && typeof v.id === 'string' && typeof v.email === 'string' && obj(v.store) && Array.isArray(v.actions);
export const searchMembers = (token: string, search: { q: string; filter: MemberFilter; sort: MemberSort; order: 'asc' | 'desc'; page: number; size: number }, o?: Options) =>
  post('/api/admin/members/search', search, validMemberPage, token, o);
export const fetchMember = (token: string, id: string, o?: Options) => get(`/api/admin/members/${encodeURIComponent(id)}`, validMember, token, o);
export const suspendMember = (token: string, id: string, reason: string, notify: boolean, o?: Options) =>
  post(`/api/admin/members/${encodeURIComponent(id)}/suspend`, { reason, notify }, validMember, token, o);
export const unsuspendMember = (token: string, id: string, reason: string, o?: Options) => post(`/api/admin/members/${encodeURIComponent(id)}/unsuspend`, { reason }, validMember, token, o);
/** Gives or takes admin rights; the owner types its own password again (routes/admin.py set_admin). */
export const setMemberAdmin = (token: string, id: string, change: { grant: boolean; reason: string; password: string; endSessions?: boolean }, o?: Options) =>
  post(`/api/admin/members/${encodeURIComponent(id)}/admin`, change, validMember, token, o);
export const signOutMember = (token: string, id: string, reason: string, o?: Options) => post(`/api/admin/members/${encodeURIComponent(id)}/signout`, { reason }, validMember, token, o);

export type TrendPoint = { day: string; requests: number; ai: number; catalog: number; errors: number; p50: number | null; p95: number | null; aiCalls: number };
export type LogRow = { id: string; at: string; category: 'food' | 'music'; engine: 'ai' | 'catalog'; latencyMs: number | null; error: string | null; tags: string[]; excluded: string[]; results: number; issues: string };
export type RecommendationBoard = { days: number; trend: TrendPoint[]; trackedSince: Record<string, string>;
  summary: { requests: number; ai: number; catalog: number; errors: number; p50: number | null; p95: number | null; aiCalls: number }; recent: LogRow[]; more: boolean };
const validBoard = (v: any): v is RecommendationBoard => obj(v) && Array.isArray(v.trend) && obj(v.summary) && Array.isArray(v.recent);
export const fetchRecommendations = (token: string, q: { days: number; kind: 'all' | 'failed' | 'catalog'; category: 'all' | 'food' | 'music'; page: number }, o?: Options) =>
  get(`/api/admin/recommendations?days=${q.days}&kind=${q.kind}&category=${q.category}&page=${q.page}`, validBoard, token, o);

export type SystemState = {
  server: { revision: string | null; service: string | null; now: string }; database: { ok: boolean; revision: string | null; pgvector: string | null };
  integrations: { key: string; label: string; on: boolean }[]; quotas: Quota[]; limits: Record<string, number>;
  clientErrors: { day: string; count: number }[]; trackedSince: Record<string, string>; retention: { label: string; days: number }[];
};
const validSystem = (v: any): v is SystemState => obj(v) && obj(v.server) && obj(v.database) && Array.isArray(v.integrations) && Array.isArray(v.quotas);
export const fetchSystem = (token: string, o?: Options) => get('/api/admin/system', validSystem, token, o);

export type AddressHistory = { address: string; total: number; first: string | null; last: string | null; events: Record<string, number>; days: { day: string; count: number }[] };
const validAddress = (v: any): v is AddressHistory => obj(v) && typeof v.address === 'string' && Array.isArray(v.days);
export const fetchAddress = (token: string, address: string, o?: Options) => post('/api/admin/access/address', { address }, validAddress, token, o);

export type ItemStatusFilter = 'all' | 'reviewed' | 'draft' | 'rejected' | 'hidden';
export type ItemRow = { id: string; category: 'food' | 'music'; name: string; artist: string | null; subtitle: string; tags: string[]; status: string; source: string;
  hiddenAt: string | null; emoji: string; color: string; releaseYear: number | null; updatedAt: string | null; openReports: number };
export type ItemPage = { items: ItemRow[]; total: number; page: number; size: number; counts: Record<string, number> };
export type ItemDetails = ItemRow & { description: string; ingredients: string[]; parentId: string | null; aiFields: string[]; reviewNotes: string[]; createdAt: string | null;
  reviewedAt: string | null; shown30d: number; reports: { id: string; at: string; kind: string; note: string; status: string }[]; actions: AuditEntry[] };
const validItemPage = (v: any): v is ItemPage => obj(v) && Array.isArray(v.items) && Number.isInteger(v.total);
const validItem = (v: any): v is ItemDetails => obj(v) && typeof v.id === 'string' && Array.isArray(v.reports) && Array.isArray(v.actions);
export const searchItems = (token: string, search: { q: string; category: 'all' | 'food' | 'music'; status: ItemStatusFilter; source: string; page: number; size: number }, o?: Options) =>
  post('/api/admin/items/search', search, validItemPage, token, o);
export const fetchItem = (token: string, id: string, o?: Options) => get(`/api/admin/items/${encodeURIComponent(id)}`, validItem, token, o);
export const hideItem = (token: string, id: string, reason: string, o?: Options) => post(`/api/admin/items/${encodeURIComponent(id)}/hide`, { reason }, validItem, token, o);
export const showItem = (token: string, id: string, reason: string, o?: Options) => post(`/api/admin/items/${encodeURIComponent(id)}/show`, { reason }, validItem, token, o);

export type AuditPage = { entries: AuditEntry[]; more: boolean };
const validAudit = (v: any): v is AuditPage => obj(v) && Array.isArray(v.entries) && typeof v.more === 'boolean';
export const fetchAudit = (token: string, q: { before?: number; action?: string; targetType?: string }, o?: Options) =>
  get(`/api/admin/audit?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString()}`, validAudit, token, o);

export const ACTION_LABEL: Record<string, string> = {
  view_member: '회원 정보 열람', suspend: '이용 정지', unsuspend: '정지 해제', signout: '강제 로그아웃', view_address: 'IP 기록 열람',
  hide_item: '항목 숨김', show_item: '숨김 해제', feedback_done: '의견 처리 완료', feedback_new: '의견 다시 열기', feedback_note: '의견 메모',
  feedback_delete: '의견 삭제', report_resolved: '신고 처리 완료', report_dismissed: '신고 반려', report_open: '신고 다시 열기', report_drop_image: '참고 사진 빼기',
  grant_admin: '관리자 지정', revoke_admin: '관리자 권한 회수',
};
