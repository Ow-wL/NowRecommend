import type { Conditions, Profile } from '../domain';
import { apiJson, API_BASE_URL } from './client';

// Lab only (plans-music-ai.md): the model recommends songs from its own knowledge, outside the catalog.
export type Confidence = 'high' | 'medium' | 'low';
export type FreeSong = { title: string; artist: string; tasteReason: string; contextReason: string; confidence: Confidence };
export type FreeBatch = { results: FreeSong[]; meta: { mode: 'free'; requestId: string; model: string | null; ai: 'used' | 'failed' | 'off'; issues: string | null; latencyMs: number } };

const text = (v: unknown, max: number) => typeof v === 'string' && v.trim() !== '' && v.length <= max;
export function validFreeBatch(v: any): v is FreeBatch {
  const m = v?.meta;
  return !!v && Array.isArray(v.results) && v.results.length <= 5
    // The server counts code points (80 and 50); JS counts UTF-16 units, so emoji take two here.
    && v.results.every((s: any) => text(s?.title, 160) && text(s?.artist, 160) && text(s?.tasteReason, 120) && text(s?.contextReason, 120) && ['high', 'medium', 'low'].includes(s?.confidence))
    && !!m && m.mode === 'free' && typeof m.requestId === 'string' && ['used', 'failed', 'off'].includes(m.ai)
    && (m.model === null || typeof m.model === 'string') && (m.issues === null || typeof m.issues === 'string') && Number.isFinite(m.latencyMs);
}

export const songLabel = (s: { title: string; artist: string }) => `${s.title} - ${s.artist}`;

export function fetchFreeSongs(request: { raw: string; conditions: Conditions; profile: Profile; likedText: string[]; avoid: string[]; count?: number; model?: string },
  options: { base?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}) {
  const { base = API_BASE_URL, fetchImpl, timeoutMs = 15000 } = options;
  const { raw, conditions, profile, likedText, avoid, count = 5, model } = request;
  return apiJson('/api/lab/music/free', validFreeBatch, { base, fetchImpl, timeoutMs, method: 'POST',
    body: { raw, conditions: { tags: conditions.tags, excluded: conditions.excluded }, profile: { selected: profile.selected, tags: profile.tags, disliked: profile.disliked },
      likedText: likedText.slice(0, 10), avoid: avoid.slice(-60), count, ...(model ? { model } : {}) } });
}

const validModels = (v: any): v is { models: string[] } => !!v && Array.isArray(v.models) && v.models.length <= 10 && v.models.every((m: unknown) => typeof m === 'string' && m.length <= 60);
export const fetchLabModels = (options: { base?: string; fetchImpl?: typeof fetch } = {}) =>
  apiJson('/api/lab/music/models', validModels, { base: options.base ?? API_BASE_URL, fetchImpl: options.fetchImpl, timeoutMs: 8000 }).then(r => r.models);
