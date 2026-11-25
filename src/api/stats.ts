import { apiJson, API_BASE_URL } from './client';
import { authHeaders } from './auth';

// The admin dashboard's daily counts (server/app/stats.py, 2026-11-23). Counts only: nothing here names a person.
export type StatsEvent = 'visit' | 'pair' | 'type:food' | 'type:music';
export type StatsDay = { day: string; counts: Record<string, number> };
export type StatsBoard = { days: StatsDay[]; totals: { accounts: number; confirmedAccounts: number; feedback: number; openReports: number } };

const validBoard = (v: any): v is StatsBoard => !!v && Array.isArray(v.days) && v.days.every((d: any) => typeof d?.day === 'string' && d.counts && typeof d.counts === 'object')
  && !!v.totals && ['accounts', 'confirmedAccounts', 'feedback', 'openReports'].every(k => Number.isInteger(v.totals[k]));
const nothing = (v: unknown): v is null => v === null;

type Options = { base?: string; fetchImpl?: typeof fetch; storage?: Pick<Storage, 'getItem' | 'setItem'> };
export function fetchStats(token: string, days: number, { base = API_BASE_URL, fetchImpl }: Options = {}) {
  return apiJson(`/api/admin/stats?days=${days}`, validBoard, { base, fetchImpl, headers: authHeaders(token) });
}

/** Tells the server one thing this browser did. Never waits on it and never fails anything: a lost count is fine. */
export function sendStat(event: StatsEvent, { base = API_BASE_URL, fetchImpl }: Options = {}) {
  apiJson('/api/stats', nothing, { base, fetchImpl, method: 'POST', body: { event }, timeoutMs: 8000 }).catch(() => { /* only a count */ });
}

const VISIT_KEY = 'nowrecommend-visit-day';
/** The day as Korean users live it: the server's days turn over at midnight KST too. */
export const kstDay = (now = new Date()) => new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
/** Counts this browser once a day: only the date of its last count is kept here (no id of any kind). */
export function countVisit(options: Options = {}, now = new Date()): boolean {
  let storage: Options['storage'];
  try { storage = options.storage ?? localStorage; } catch { return false; }
  const today = kstDay(now);
  try { if (storage.getItem(VISIT_KEY) === today) return false; storage.setItem(VISIT_KEY, today); } catch { return false; }  // no storage: not counted, so not counted again and again
  sendStat('visit', options);
  return true;
}

// More of what the server already keeps (2026-11-24): how recommendations went, accounts, and the 30-day access list.
export type TopItem = { id: string; name: string; artist: string; count: number };
export type TopTag = { tag: string; count: number };
export type CategoryInsight = { requests: number; ai: number; fallback: number; errors: number; latencyP50: number | null; latencyP95: number | null;
  issues: Record<string, number>; topItems: TopItem[]; topTags: TopTag[]; topExcluded: TopTag[] };
export type Insights = {
  days: number; recommendations: Partial<Record<'food' | 'music', CategoryInsight>>; hours: number[];
  accounts: { total: number; confirmed: number; admins: number; newInPeriod: number; activeWeek: number; withSavedData: number };
  access: { addressesToday: number; addressesInPeriod: number; busiest: { address: string; count: number; last: string }[] };
  ai: { usedToday: number; dailyLimit: number }; feedbackKinds: Record<string, number>; reportStatus: Record<string, number>;
};
const validInsights = (v: any): v is Insights => !!v && Number.isInteger(v.days) && !!v.recommendations && typeof v.recommendations === 'object'
  && Array.isArray(v.hours) && v.hours.length === 24 && !!v.accounts && !!v.access && Array.isArray(v.access.busiest) && !!v.ai;
export function fetchInsights(token: string, days: number, { base = API_BASE_URL, fetchImpl }: Options = {}) {
  return apiJson(`/api/admin/insights?days=${days}`, validInsights, { base, fetchImpl, headers: authHeaders(token) });
}

export type AccessEntry = { id: number; at: string; address: string; event: string };
export type AccessPage = { entries: AccessEntry[]; more: boolean };
const validAccess = (v: any): v is AccessPage => !!v && typeof v.more === 'boolean' && Array.isArray(v.entries)
  && v.entries.every((e: any) => Number.isInteger(e?.id) && typeof e.at === 'string' && typeof e.address === 'string' && typeof e.event === 'string');
/** `filter` (2026-11-26): an address's start, one event, one day (YYYY-MM-DD, KST), narrowed on the server. */
export function fetchAccess(token: string, before?: number, { base = API_BASE_URL, fetchImpl, filter = {} }: Options & { filter?: { address?: string; event?: string; day?: string } } = {}) {
  // In a POST body (2026-11-26), so an address looked for stays out of request logs; the server records the look.
  return apiJson('/api/admin/access/search', validAccess, { base, fetchImpl, method: 'POST', body: { limit: 100, ...(before ? { before } : {}), ...Object.fromEntries(Object.entries(filter).filter(([, v]) => v)) }, headers: authHeaders(token) });
}
