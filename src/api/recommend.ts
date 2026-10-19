import type { Profile, Recommendation, Session } from '../domain';
import { validRecommendation } from '../sessionStorage';
import { apiJson, API_BASE_URL } from './client';

export type RecommendMeta = { mode: 'rag' | 'retrieval_only'; eligibleCount: number; newCount: number; catalogVersion: string; requestId: string; contextSimilarity?: boolean };
export type RemoteBatch = { results: Recommendation[]; meta: RecommendMeta };

export function validRemoteBatch(v: any): v is RemoteBatch {
  const m = v?.meta;
  return !!v && Array.isArray(v.results) && v.results.length <= 5 && v.results.every(validRecommendation)
    && new Set(v.results.map((r: Recommendation) => r.item.id)).size === v.results.length
    && !!m && ['rag', 'retrieval_only'].includes(m.mode) && Number.isInteger(m.eligibleCount) && Number.isInteger(m.newCount)
    && typeof m.catalogVersion === 'string' && typeof m.requestId === 'string';
}

/** Request body for POST /api/recommend (server/app/schemas.py). Only what ranking needs leaves the browser. */
export function recommendBody(session: Session, profile: Profile, count?: number) {
  return {
    category: session.category, raw: session.raw, conditions: session.conditions,
    profile: { selected: profile.selected, tags: profile.tags, disliked: profile.disliked },
    excludedIds: session.excludedIds, seenIds: session.seenIds || [], pinnedIds: session.pinnedIds || [],
    candidateIds: session.candidateScope === 'favorites' ? session.candidateIds || [] : null,
    ...(count === undefined ? {} : { count }),
  };
}

export function fetchRecommendations(session: Session, profile: Profile, options: { count?: number; base?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}) {
  const { count, base = API_BASE_URL, fetchImpl, timeoutMs = 12000 } = options;
  return apiJson('/api/recommend', validRemoteBatch, { base, fetchImpl, timeoutMs, method: 'POST', body: recommendBody(session, profile, count) });
}
