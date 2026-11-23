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
