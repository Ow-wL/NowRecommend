import { cleanConditions, type Profile, type Recommendation, type Session } from '../domain';
import { normalizeItem } from '../data';
import { knownCatalogItems } from '../catalog';
import { validRecommendation } from '../sessionStorage';
import { apiJson, API_BASE_URL } from './client';

export type Engine = 'ai' | 'catalog';
export type RecommendMeta = { mode: 'rag' | 'retrieval_only'; eligibleCount: number; newCount: number; catalogVersion: string; requestId: string;
  contextSimilarity?: boolean; ai?: 'used' | 'failed' | 'off'; situational?: boolean;
  /** 2026-11-02: which engine answered. `engineWanted` is set when the AI engine fell back to the catalog. */
  engine?: Engine; engineWanted?: 'ai'; model?: string | null; aiError?: string | null; issues?: string | null };
export type RemoteBatch = { results: Recommendation[]; meta: RecommendMeta };

export function validRemoteBatch(v: any): v is RemoteBatch {
  const m = v?.meta;
  return !!v && Array.isArray(v.results) && v.results.length <= 5 && v.results.every(validRecommendation)
    && new Set(v.results.map((r: Recommendation) => r.item.id)).size === v.results.length
    && !!m && ['rag', 'retrieval_only'].includes(m.mode) && Number.isInteger(m.eligibleCount) && Number.isInteger(m.newCount)
    && typeof m.catalogVersion === 'string' && typeof m.requestId === 'string'
    && (m.ai === undefined || ['used', 'failed', 'off'].includes(m.ai)) && (m.contextSimilarity === undefined || typeof m.contextSimilarity === 'boolean')
    && (m.situational === undefined || typeof m.situational === 'boolean')
    && (m.engine === undefined || ['ai', 'catalog'].includes(m.engine)) && (m.engineWanted === undefined || m.engineWanted === 'ai')
    && (m.model === undefined || m.model === null || typeof m.model === 'string');
}

/** What the person wrote, as words for the AI: "치킨: 바삭해서", or a typed-in favourite. Item names come from the catalog here. */
function tasteNotes(profile: Profile) {
  const named = (name: string, reason?: string) => (reason?.trim() ? `${name}: ${reason.trim()}` : name).slice(0, 120);
  const notes = [...profile.selected.flatMap(id => { const reason = profile.reasons?.[id]?.trim(), item = knownCatalogItems().find(i => i.id === id); return reason && item ? [named(item.name, reason)] : []; }),
    ...(profile.custom || []).map(c => named(c.name, c.reason))].slice(0, 40);
  const customNames = (profile.custom || []).map(c => c.name.slice(0, 120)).slice(0, 30);
  return { ...(notes.length ? { notes } : {}), ...(customNames.length ? { customNames } : {}) };
}

/** Request body for POST /api/recommend (server/app/schemas.py). Only what ranking needs leaves the browser. */
export function recommendBody(session: Session, profile: Profile, count?: number, engine?: Engine) {
  return {
    category: session.category, raw: session.raw, conditions: cleanConditions(session.conditions),
    profile: { selected: profile.selected, tags: profile.tags, disliked: profile.disliked, ...tasteNotes(profile) },
    excludedIds: session.excludedIds, seenIds: session.seenIds || [], pinnedIds: session.pinnedIds || [],
    candidateIds: session.candidateScope === 'favorites' ? session.candidateIds || [] : null,
    ...(session.category === 'music' && session.years ? { years: session.years } : {}),
    ...(count === undefined ? {} : { count }),
    ...(engine === undefined ? {} : { engine }),
  };
}

/** Older servers send no `ai`/`situational`/`engine`; treat that as "nothing to report" from the catalog. */
export function qualityOf(meta: RecommendMeta): NonNullable<Session['quality']> {
  return { ai: meta.ai ?? 'off', context: !meta.situational || meta.contextSimilarity !== false, engine: meta.engine ?? 'catalog', ...(meta.engineWanted ? { wanted: meta.engineWanted } : {}) };
}

export function fetchRecommendations(session: Session, profile: Profile, options: { count?: number; engine?: Engine; base?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}) {
  // Longer than the server's 10s rerank deadline plus the query embedding, so a slow model degrades to retrieval_only first.
  const { count, engine, base = API_BASE_URL, fetchImpl, timeoutMs = 15000 } = options;
  return apiJson('/api/recommend', validRemoteBatch, { base, fetchImpl, timeoutMs, method: 'POST', body: recommendBody(session, profile, count, engine) })
    .then(batch => ({ ...batch, results: batch.results.map(r => ({ ...r, item: normalizeItem(r.item) })) }));
}
