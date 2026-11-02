import type { Conditions, Profile } from '../domain';
import type { Category, Item } from '../data';
import { validItem } from '../catalog';
import { apiJson, API_BASE_URL } from './client';

// Lab only (plans-music-ai.md): the model recommends from its own knowledge, outside the catalog. Since 2026-11-02 the
// same endpoint exists for food (/api/lab/food/free) and every pick comes with the item the server stored for it.
export type Confidence = 'high' | 'medium' | 'low';
export type FreePick = { name: string; detail: string; tasteReason: string; contextReason: string; confidence: Confidence; tags: string[]; item: Item };
export type FreeBatch = { results: FreePick[]; meta: { mode: 'free'; category?: Category; requestId: string; model: string | null; ai: 'used' | 'failed' | 'off'; issues: string | null; latencyMs: number } };

const text = (v: unknown, max: number) => typeof v === 'string' && v.trim() !== '' && v.length <= max;
export function validFreeBatch(v: any): v is FreeBatch {
  const m = v?.meta;
  return !!v && Array.isArray(v.results) && v.results.length <= 5
    // The server counts code points (80 and 50); JS counts UTF-16 units, so emoji take two here. Food picks may have no detail.
    && v.results.every((s: any) => text(s?.name, 160) && typeof s?.detail === 'string' && s.detail.length <= 160 && text(s?.tasteReason, 120) && text(s?.contextReason, 120)
      && ['high', 'medium', 'low'].includes(s?.confidence) && Array.isArray(s?.tags) && s.tags.every((t: unknown) => typeof t === 'string') && validItem(s?.item))
    && !!m && m.mode === 'free' && typeof m.requestId === 'string' && ['used', 'failed', 'off'].includes(m.ai)
    && (m.model === null || typeof m.model === 'string') && (m.issues === null || typeof m.issues === 'string') && Number.isFinite(m.latencyMs);
}

/** 'name - detail' (a bare name when there is no detail): the format the server's avoid list uses. */
export const pickLabel = (s: { name: string; detail?: string }) => s.detail ? `${s.name} - ${s.detail}` : s.name;

export function fetchFreePicks(category: Category, request: { raw: string; conditions: Conditions; profile: Profile; likedText: string[]; avoid: string[]; count?: number; model?: string },
  options: { base?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}) {
  const { base = API_BASE_URL, fetchImpl, timeoutMs = 15000 } = options;
  const { raw, conditions, profile, likedText, avoid, count = category === 'food' ? 3 : 5, model } = request;
  return apiJson(`/api/lab/${category}/free`, validFreeBatch, { base, fetchImpl, timeoutMs, method: 'POST',
    body: { raw, conditions: { tags: conditions.tags, excluded: conditions.excluded }, profile: { selected: profile.selected, tags: profile.tags, disliked: profile.disliked },
      likedText: likedText.slice(0, 10), avoid: avoid.slice(-60), count, ...(model ? { model } : {}) } });
}

const validModels = (v: any): v is { models: string[] } => !!v && Array.isArray(v.models) && v.models.length <= 10 && v.models.every((m: unknown) => typeof m === 'string' && m.length <= 60);
export const fetchLabModels = (options: { base?: string; fetchImpl?: typeof fetch } = {}) =>
  apiJson('/api/lab/models', validModels, { base: options.base ?? API_BASE_URL, fetchImpl: options.fetchImpl, timeoutMs: 8000 }).then(r => r.models);
