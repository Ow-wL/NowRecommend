import { afterEach, describe, expect, it, vi } from 'vitest';
import { LEGAL_VERSION } from './legal';
import { HealthConsentNeeded, healthConsented, healthTerms, newHealthConsent, noteHealthConsent, sendable, sendableNotes, storeHealthTerms, withoutHealthProfile, withoutHealthTexts } from './sensitive';
import { recommendBody, fetchRecommendations } from './api/recommend';
import { fetchParse } from './api/parse';
import { emptyConditions, emptyStore, type HistoryEntry, type Store } from './domain';
import { newSession } from './sessionStorage';
import { decodeStore } from './storage';
import { indexStore, mergeStores } from './sync';

afterEach(() => { noteHealthConsent(null); vi.unstubAllGlobals(); });

const entry = (id: string, raw: string, note?: string): HistoryEntry => {
  const result = { item: { id: 'f01', name: '쌀국수', category: 'food' as const, tags: [], ingredients: [] }, tasteReason: '', contextReason: '' };
  return { id, date: '2026-11-17T01:00:00.000Z', category: 'food', raw, conditions: emptyConditions(), resultIds: ['f01'],
    rounds: [{ id: `${id}-r`, date: '2026-11-17T01:00:00.000Z', raw, conditions: emptyConditions(), results: [result as never], feedback: [], excludedIds: [] }],
    ...(note === undefined ? {} : { selected: { result: result as never, date: '2026-11-17T01:01:00.000Z', roundId: `${id}-r` }, review: { rating: 'good', note, date: '2026-11-17T01:02:00.000Z', itemId: 'f01', roundId: `${id}-r` } }) };
};
function storeWith(): Store {
  const store = emptyStore();
  store.profiles.food = { selected: ['f01', 'f02'], tags: [], disliked: [], reasons: { f01: '국물이 좋아서', f02: '위염일 때 편해서' },
    custom: [{ id: 'c1', name: '당뇨식 도시락' }, { id: 'c2', name: '마라샹궈', reason: '얼얼해서' }, { id: 'c3', name: '죽', reason: '감기 걸리면 생각나서' }] };
  store.history = [entry('h1', '비 오는 날 국물'), entry('h2', '땅콩 알레르기 있어요', '맛있었음'), entry('h3', '든든한 한 끼', '속이 안 좋아서 반만 먹음')];
  store.presets = [{ id: 'p1', category: 'food', name: '임신 중 식단', conditions: emptyConditions() }, { id: 'p2', category: 'food', name: '야식', conditions: emptyConditions() }];
  return store;
}

describe('words about health in what a person types', () => {
  it('finds what says something about a body or an illness, and leaves taste alone', () => {
    expect(healthTerms('땅콩 알레르기 있어요')).toEqual(['알레르기']);
    expect(healthTerms('유당 불내증이라 우유는 안 돼요', '당뇨가 있어서 단 건 피해요')).toEqual(['불내증', '당뇨']);
    expect(healthTerms('임신 중이라 날것은 빼줘', '위염 때문에 약  먹는 중')).toEqual(['임신', '위염', '약 먹']);
    expect(healthTerms('감기 걸려서 따뜻한 거', '속이 안 좋아요', '목이 아파서 부드러운 걸로', '생리통 심한 날')).toEqual(['감기', '속이 안 좋', '아파서', '생리통']);
    expect(healthTerms('알러지, 알러지')).toEqual(['알러지']);  // each word once
    // Taste, diet and mood are not health; neither are words that only look like it.
    for (const plain of ['땅콩 제외', '매운 거 못 먹어요', '비건 메뉴로', '다이어트 중이라 가볍게', '우울한 날 듣기 좋은 노래', '비 오는 날 국물', '', '운동하고 나서 든든하게', '내 취향 유형 진단', '성공 처방 같은 노래'])
      expect(healthTerms(plain)).toEqual([]);
    expect(healthTerms(null, undefined)).toEqual([]);
  });

  it('holds the consent for the policy it was given under', () => {
    expect(healthConsented()).toBe(false);
    noteHealthConsent(newHealthConsent(new Date('2026-11-17T12:00:00Z')));
    expect(healthConsented()).toBe(true);
    noteHealthConsent({ version: '2020-01-01', at: '2020-01-01T00:00:00.000Z' });
    expect(healthConsented()).toBe(false);  // given to older documents: asked again
    noteHealthConsent({ version: LEGAL_VERSION } as never);
    expect(healthConsented()).toBe(false);  // not a consent
  });

  it('lets nothing with those words leave the browser until there is consent', async () => {
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

    noteHealthConsent(newHealthConsent());
    expect(sendable('땅콩 알레르기 있어요')).toBe('땅콩 알레르기 있어요');
    expect(recommendBody(about, profile).raw).toBe('땅콩 알레르기 있어요');
    expect(recommendBody(about, profile).profile.customNames).toEqual(['당뇨식 도시락', '마라샹궈']);
  });
});

describe('a store that holds such words', () => {
  it('is seen in every text a person typed', () => {
    expect(storeHealthTerms(emptyStore())).toEqual([]);
    expect(storeHealthTerms(storeWith()).sort()).toEqual(['감기', '당뇨', '속이 안 좋', '알레르기', '위염', '임신'].sort());
  });

  it('loses only those texts when the person does not agree: what was chosen and rated stays', () => {
    const before = storeWith(), after = withoutHealthTexts(before);
    expect(storeHealthTerms(after)).toEqual([]);
    expect(after.profiles.food.selected).toEqual(['f01', 'f02']);
    expect(after.profiles.food.reasons).toEqual({ f01: '국물이 좋아서' });
    expect(after.profiles.food.custom).toEqual([{ id: 'c2', name: '마라샹궈', reason: '얼얼해서' }, { id: 'c3', name: '죽' }]);
    expect(after.history.map(h => h.raw)).toEqual(['비 오는 날 국물', '직접 선택한 조건', '든든한 한 끼']);
    expect(after.history[1].rounds[0].raw).toBe('직접 선택한 조건');
    expect(after.history[1].review).toMatchObject({ rating: 'good', note: '맛있었음' });
    expect(after.history[2].review).toMatchObject({ rating: 'good', note: '' });
    expect(after.history.map(h => h.resultIds)).toEqual(before.history.map(h => h.resultIds));
    expect(after.presets!.map(p => p.name)).toEqual(['내 조건', '야식']);
    expect(before.history[1].raw).toBe('땅콩 알레르기 있어요');  // the store handed in is not changed
    expect(withoutHealthProfile(emptyStore().profiles.food)).toEqual(emptyStore().profiles.food);
  });

  it('carries the consent: through storage, and between devices in both directions', () => {
    const consent = newHealthConsent(new Date('2026-11-17T12:00:00Z'));
    const kept = decodeStore(JSON.stringify({ ...emptyStore(), health: consent }))!;
    expect(kept.health).toEqual(consent);
    expect(decodeStore(JSON.stringify({ ...emptyStore(), health: { version: 3 } }))!.health).toBeUndefined();  // unreadable: no consent, and the store still opens

    const agreed: Store = { ...emptyStore(), health: consent }, plain = emptyStore();
    // Given on another device: this one has it after the merge, whether or not the two ever agreed on a copy.
    expect(mergeStores(null, plain, agreed).health).toEqual(consent);
    expect(mergeStores(indexStore(plain), plain, agreed).health).toEqual(consent);
    // Withdrawn here, still on the account: it stays withdrawn. Withdrawn there, still here: withdrawn here too.
    expect(mergeStores(indexStore(agreed), plain, agreed).health).toBeUndefined();
    expect(mergeStores(indexStore(agreed), agreed, plain).health).toBeUndefined();
    // An agreement saved before the consent existed says nothing about it: a consent on either side is kept.
    const { health: _, ...older } = indexStore(plain);
    expect(mergeStores(older, agreed, plain).health).toEqual(consent);
    expect(mergeStores(older, plain, agreed).health).toEqual(consent);
  });
});
