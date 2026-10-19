import { describe, expect, it } from 'vitest';
import { ApiError, apiJson } from './api/client';
import { qualityOf, recommendBody, validRemoteBatch } from './api/recommend';
import { items } from './data';
import { emptyConditions, type Session } from './domain';

const BASE = 'http://api.test';
const any = (v: unknown): v is unknown => true;
const json = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });
const failure = async (promise: Promise<unknown>) => { try { await promise; } catch (e) { return e as ApiError; } throw new Error('expected failure'); };

describe('apiJson', () => {
  it('refuses to call anything in offline mode', async () => {
    let called = false;
    const error = await failure(apiJson('/api/catalog', any, { base: '', fetchImpl: async () => { called = true; return new Response('{}'); } }));
    expect([error.kind, called]).toEqual(['offline', false]);
  });
  it('classifies timeouts, HTTP errors, bad bodies and network errors', async () => {
    const hang: typeof fetch = (_, init) => new Promise((_, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    expect((await failure(apiJson('/x', any, { base: BASE, fetchImpl: hang, timeoutMs: 5 }))).kind).toBe('timeout');
    const http = await failure(apiJson('/x', any, { base: BASE, fetchImpl: json({}, 503) }));
    expect([http.kind, http.status]).toEqual(['http', 503]);
    expect((await failure(apiJson('/x', (v): v is { ok: true } => (v as any)?.ok === true, { base: BASE, fetchImpl: json({ ok: false }) }))).kind).toBe('invalid');
    expect((await failure(apiJson('/x', any, { base: BASE, fetchImpl: async () => new Response('not json') }))).kind).toBe('invalid');
    expect((await failure(apiJson('/x', any, { base: BASE, fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }))).kind).toBe('offline');
  });
  it('sends JSON bodies to the configured base', async () => {
    let seen: [string, RequestInit | undefined] | undefined;
    const value = await apiJson('/api/recommend', any, { base: BASE, method: 'POST', body: { a: 1 }, fetchImpl: async (url, init) => { seen = [String(url), init]; return new Response('{"ok":1}'); } });
    expect(value).toEqual({ ok: 1 });
    expect(seen?.[0]).toBe('http://api.test/api/recommend');
    expect(seen?.[1]?.body).toBe('{"a":1}');
  });
});

describe('recommend request and response', () => {
  const session: Session = { category: 'food', raw: '담백한 저녁', conditions: { ...emptyConditions(), excluded: ['밀'] }, excludedIds: ['f01'], revision: 0, seenIds: ['f02'], pinnedIds: ['f03'], snapshot: [] };
  const profile = { selected: ['f04'], tags: ['담백함'], disliked: ['f05'] };
  it('sends only what ranking needs', () => {
    expect(recommendBody(session, profile)).toEqual({ category: 'food', raw: '담백한 저녁', conditions: session.conditions, profile,
      excludedIds: ['f01'], seenIds: ['f02'], pinnedIds: ['f03'], candidateIds: null });
    expect(recommendBody({ ...session, candidateScope: 'favorites', candidateIds: ['f07'] }, profile, 1)).toMatchObject({ candidateIds: ['f07'], count: 1 });
  });
  it('validates the server batch', () => {
    const result = { item: items[0], tasteReason: 'a', contextReason: 'b' };
    const meta = { mode: 'retrieval_only', eligibleCount: 3, newCount: 1, catalogVersion: 'db-1', requestId: 'r' };
    expect(validRemoteBatch({ results: [result], meta })).toBe(true);
    expect(validRemoteBatch({ results: [result, result], meta })).toBe(false);
    expect(validRemoteBatch({ results: [{ ...result, item: { ...items[0], tags: 'x' } }], meta })).toBe(false);
    expect(validRemoteBatch({ results: [result], meta: { ...meta, mode: 'magic' } })).toBe(false);
    expect(validRemoteBatch({ results: [result], meta: { ...meta, ai: 'failed', situational: true, contextSimilarity: false } })).toBe(true);
    expect(validRemoteBatch({ results: [result], meta: { ...meta, ai: 'maybe' } })).toBe(false);
  });
  it('turns server meta into the quality shown on the results screen', () => {
    const meta = { mode: 'retrieval_only' as const, eligibleCount: 3, newCount: 1, catalogVersion: 'db-1', requestId: 'r' };
    expect(qualityOf(meta)).toEqual({ ai: 'off', context: true });  // older servers report nothing
    expect(qualityOf({ ...meta, ai: 'failed', situational: true, contextSimilarity: false })).toEqual({ ai: 'failed', context: false });
    expect(qualityOf({ ...meta, ai: 'used', situational: false, contextSimilarity: false })).toEqual({ ai: 'used', context: true });  // nothing to embed
  });
});
