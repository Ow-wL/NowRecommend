import type { Category } from '../data';
import { apiJson, API_BASE_URL } from './client';
import { authHeaders } from './auth';

// Error reports (server/app/routes/reports.py): anyone can send one, an admin account reads them.
export type ReportKind = 'wrong_image' | 'wrong_info' | 'not_exist' | 'other';
export type ReportStatus = 'open' | 'resolved' | 'dismissed';
export type Report = { id: string; createdAt: string; kind: ReportKind; note: string; status: ReportStatus; resolvedAt: string | null; byMember: boolean; canDropImage: boolean;
  item: { id: string; category: Category; name: string; subtitle: string; parentId?: string } };
export type ReportList = { reports: Report[]; counts: Record<ReportStatus, number> };

const KINDS: ReportKind[] = ['wrong_image', 'wrong_info', 'not_exist', 'other'];
const STATUSES: ReportStatus[] = ['open', 'resolved', 'dismissed'];
export const validReport = (v: any): v is Report => !!v && typeof v.id === 'string' && typeof v.createdAt === 'string' && KINDS.includes(v.kind) && typeof v.note === 'string' && STATUSES.includes(v.status)
  && typeof v.byMember === 'boolean' && typeof v.canDropImage === 'boolean' && !!v.item && typeof v.item.id === 'string' && ['food', 'music'].includes(v.item.category) && typeof v.item.name === 'string' && typeof v.item.subtitle === 'string';
const validList = (v: any): v is ReportList => !!v && Array.isArray(v.reports) && v.reports.every(validReport) && !!v.counts && STATUSES.every(s => Number.isInteger(v.counts[s]));
const validCreated = (v: any): v is { id: string } => !!v && typeof v.id === 'string';

type Options = { base?: string; fetchImpl?: typeof fetch };
export function sendReport(report: { itemId: string; kind: ReportKind; note: string }, token?: string, { base = API_BASE_URL, fetchImpl }: Options = {}) {
  return apiJson('/api/reports', validCreated, { base, fetchImpl, method: 'POST', body: report, ...(token ? { headers: authHeaders(token) } : {}) });
}
export function fetchReports(token: string, status: ReportStatus | 'all', { base = API_BASE_URL, fetchImpl }: Options = {}) {
  return apiJson(`/api/admin/reports?status=${status}`, validList, { base, fetchImpl, headers: authHeaders(token) });
}
export function updateReport(token: string, id: string, update: { status?: ReportStatus; dropImage?: boolean }, { base = API_BASE_URL, fetchImpl }: Options = {}) {
  return apiJson(`/api/admin/reports/${id}`, validReport, { base, fetchImpl, method: 'POST', body: update, headers: authHeaders(token) });
}

export function kindLabel(kind: ReportKind, category: Category): string {
  const food = category === 'food';
  return { wrong_image: food ? '사진이 메뉴와 달라요' : '앨범 표지가 달라요', wrong_info: food ? '메뉴 정보나 재료가 틀려요' : '곡 정보나 링크가 틀려요', not_exist: food ? '없는 메뉴예요' : '없는 곡이에요', other: '기타' }[kind];
}
export const reportKinds = KINDS;
