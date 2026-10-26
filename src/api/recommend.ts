import { cleanConditions, type Profile, type Recommendation, type Session } from '../domain';
import { normalizeItem } from '../data';
import { validRecommendation } from '../sessionStorage';
import { apiJson, API_BASE_URL } from './client';

export type RecommendMeta = { mode: 'rag' | 'retrieval_only'; eligibleCount: number; newCount: number; catalogVersion: string; requestId: string;
  contextSimilarity?: boolean; ai?: 'used' | 'failed' | 'off'; situational?: boolean };
export type RemoteBatch = { results: Recommendation[]; meta: RecommendMeta };

export function validRemoteBatch(v: any): v is RemoteBatch {
  const m = v?.meta;
  return !!v && Array.isArray(v.results) && v.results.length <= 5 && v.results.every(validRecommendation)
    && new Set(v.results.map((r: Recommendation) => r.item.id)).size === v.results.length
    && !!m && ['rag', 'retrieval_only'].includes(m.mode) && Number.isInteger(m.eligibleCount) && Number.isInteger(m.newCount)
    && typeof m.catalogVersion === 'string' && typeof m.requestId === 'string'
    && (m.ai === undefined || ['used', 'failed', 'off'].includes(m.ai)) && (m.contextSimilarity === undefined || typeof m.contextSimilarity === 'boolean')
    && (m.situational === undefined || typeof m.situational === 'boolean');
}

/** Request body for POST /api/recommend (server/app/schemas.py). Only what ranking needs leaves the browser. */
export function recommendBody(session: Session, profile: Profile, count?: number) {
  return {
    category: session.category, raw: session.raw, conditions: cleanConditions(session.conditions),
    profile: { selected: profile.selected, tags: profile.tags, disliked: profile.disliked },
    excludedIds: session.excludedIds, seenIds: session.seenIds || [], pinnedIds: session.pinnedIds || [],
    candidateIds: session.candidateScope === 'favorites' ? session.candidateIds || [] : null,
    ...(count === undefined ? {} : { count }),
  };
}

/** Older servers send no `ai`/`situational`; treat that as "nothing to report". */
export function qualityOf(meta: RecommendMeta): NonNullable<Session['quality']> {
  return { ai: meta.ai ?? 'off', context: !meta.situational || meta.contextSimilarity !== false };
}

export function fetchRecommendations(session: Session, profile: Profile, options: { count?: number; base?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}) {
  // Longer than the server's 10s rerank deadline plus the query embedding, so a slow model degrades to retrieval_only first.
  const { count, base = API_BASE_URL, fetchImpl, timeoutMs = 15000 } = options;
  return apiJson('/api/recommend', validRemoteBatch, { base, fetchImpl, timeoutMs, method: 'POST', body: recommendBody(session, profile, count) })
    .then(batch => ({ ...batch, results: batch.results.map(r => ({ ...r, item: normalizeItem(r.item) })) }));
}
