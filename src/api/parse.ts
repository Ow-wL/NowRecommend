import type { Conditions } from '../domain';
import type { Category } from '../data';
import { validConditions } from '../sessionStorage';
import { apiJson, API_BASE_URL } from './client';

export type ParseSource = 'rule' | 'rule+ai';
export type RemoteParse = { conditions: Conditions; unparsed: string[]; source: ParseSource; ai: 'not_needed' | 'used' | 'unavailable' | 'failed' };

export function validRemoteParse(v: any): v is RemoteParse {
  return !!v && validConditions(v.conditions) && Array.isArray(v.unparsed) && v.unparsed.length <= 20 && v.unparsed.every((p: unknown) => typeof p === 'string' && p.length <= 60)
    && ['rule', 'rule+ai'].includes(v.source) && ['not_needed', 'used', 'unavailable', 'failed'].includes(v.ai);
}

/** The server runs the same rules as parseConditions and asks the model only about words they missed. */
export function fetchParse(category: Category, text: string, options: { base?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}) {
  const { base = API_BASE_URL, fetchImpl, timeoutMs = 13000 } = options;
  return apiJson('/api/parse', validRemoteParse, { base, fetchImpl, timeoutMs, method: 'POST', body: { category, text } });
}
