import { afterEach, describe, expect, it, vi } from 'vitest';
import { LEGAL_VERSION } from './legal';
import { HEALTH_KEY, HealthConsentNeeded, giveHealthConsent, healthConsent, healthConsented, healthTerms, sendable, sendableNotes, withdrawHealthConsent } from './sensitive';
import { recommendBody, fetchRecommendations } from './api/recommend';
import { fetchParse } from './api/parse';
import { emptyStore } from './domain';
import { newSession } from './sessionStorage';

function area(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); }, keys: () => [...data.keys()] };
}
afterEach(() => vi.unstubAllGlobals());

describe('words about health in what a person types', () => {
  it('finds what says something about a body or an illness, and leaves taste alone', () => {
    expect(healthTerms('땅콩 알레르기 있어요')).toEqual(['알레르기']);
    expect(healthTerms('유당 불내증이라 우유는 안 돼요', '당뇨가 있어서 단 건 피해요')).toEqual(['불내증', '당뇨']);
    expect(healthTerms('임신 중이라 날것은 빼줘', '위염 때문에 약  먹는 중')).toEqual(['임신', '위염', '약 먹']);
    expect(healthTerms('알러지, 알러지')).toEqual(['알러지']);  // each word once
    // Taste, diet and mood are not health.
    for (const plain of ['땅콩 제외', '매운 거 못 먹어요', '비건 메뉴로', '다이어트 중이라 가볍게', '우울한 날 듣기 좋은 노래', '비 오는 날 국물', '', '운동하고 나서 든든하게'])
      expect(healthTerms(plain)).toEqual([]);
    expect(healthTerms(null, undefined)).toEqual([]);
  });

  it('remembers the consent with the policy it was given under, and forgets it when withdrawn or when the policy moves', () => {
    const local = area();
    vi.stubGlobal('localStorage', local);
    expect(healthConsented()).toBe(false);
    giveHealthConsent(new Date('2026-11-17T12:00:00Z'));
    expect(healthConsent()).toEqual({ version: LEGAL_VERSION, at: '2026-11-17T12:00:00.000Z' });
    expect(healthConsented()).toBe(true);
    local.setItem(HEALTH_KEY, JSON.stringify({ version: '2020-01-01', at: '2020-01-01T00:00:00.000Z' }));
    expect(healthConsented()).toBe(false);  // given to older documents: asked again
    giveHealthConsent();
    withdrawHealthConsent();
    expect(healthConsent()).toBeNull();
    local.setItem(HEALTH_KEY, 'not json');
    expect(healthConsent()).toBeNull();
  });

  it('lets nothing with those words leave the browser until there is consent', async () => {
    vi.stubGlobal('localStorage', area());
    expect(sendable('땅콩 제외')).toBe('땅콩 제외');
    expect(() => sendable('땅콩 알레르기 있어요')).toThrow(HealthConsentNeeded);
    expect(sendableNotes(['치킨: 바삭해서', '죽: 위염일 때 편해서', '재즈'])).toEqual(['치킨: 바삭해서', '재즈']);

    const profile = { ...emptyStore().profiles.food, custom: [{ id: 'c1', name: '당뇨식 도시락' }, { id: 'c2', name: '마라샹궈', reason: '얼얼해서' }] };
    const plain = { ...newSession('food'), raw: '비 오는 날 국물' }, about = { ...newSession('food'), raw: '땅콩 알레르기 있어요' };
    const body = recommendBody(plain, profile);
    expect(body.profile.notes).toEqual(['마라샹궈: 얼얼해서']);
    expect(body.profile.customNames).toEqual(['마라샹궈']);
    expect(() => recommendBody(about, profile)).toThrow(HealthConsentNeeded);

    // The requests themselves: refused before anything is fetched.
    const fetchImpl = vi.fn();
    await expect(fetchRecommendations(about, profile, { base: 'http://api.test', fetchImpl })).rejects.toBeInstanceOf(HealthConsentNeeded);
    await expect(fetchParse('food', '땅콩 알레르기 있어요', { base: 'http://api.test', fetchImpl })).rejects.toBeInstanceOf(HealthConsentNeeded);
    expect(fetchImpl).not.toHaveBeenCalled();

    giveHealthConsent();
    expect(sendable('땅콩 알레르기 있어요')).toBe('땅콩 알레르기 있어요');
    expect(recommendBody(about, profile).raw).toBe('땅콩 알레르기 있어요');
    expect(recommendBody(about, profile).profile.customNames).toEqual(['당뇨식 도시락', '마라샹궈']);
  });
});
