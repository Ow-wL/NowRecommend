import { describe, expect, it } from 'vitest';
import { capFamiliar, changeText, checkText, inYears, parseYears, yearLabel, conditionChecks, emptyConditions, emptyProfile, NO_TASTE_REASON, parseConditions, recommend, updateFeedback, type Session, evidenceText } from './domain';
import { items } from './data';
const session = (changes: Partial<Session> = {}): Session => ({ category: 'food', raw: '', conditions: emptyConditions(), excludedIds: [], revision: 0, ...changes });
describe('release years', () => {
  it('reads the years a sentence names', () => {
    const at = 2026;
    expect(parseYears('90년대 발라드', at)).toEqual({ from: 1990, to: 1999 });
    expect(parseYears('10년대 노래', at)).toEqual({ from: 2010, to: 2019 });
    expect(parseYears('2010년대', at)).toEqual({ from: 2010, to: 2019 });
    expect(parseYears('2015년 이후 곡', at)).toEqual({ from: 2015 });
    expect(parseYears('2000년 이전 노래', at)).toEqual({ to: 2000 });
    expect(parseYears('2010년부터 2015년까지', at)).toEqual({ from: 2010, to: 2015 });
    expect(parseYears('2017년 노래', at)).toEqual({ from: 2017, to: 2017 });
    expect(parseYears('요즘 노래', at)).toEqual({ from: 2024 });
    expect(parseYears('비 오는 밤', at)).toBeUndefined();
  });
  it('labels and checks a range; no known year is outside every range', () => {
    expect(yearLabel({ from: 1990, to: 1999 })).toBe('1990년대');
    expect(yearLabel({ from: 2015 })).toBe('2015년 이후');
    expect(yearLabel({ from: 2010, to: 2015 })).toBe('2010~2015년');
    expect(inYears({ releaseYear: 1995 }, { from: 1990, to: 1999 })).toBe(true);
    expect(inYears({ releaseYear: 2001 }, { from: 1990, to: 1999 })).toBe(false);
    expect(inYears({}, { from: 1990 })).toBe(false);
  });
  it('follows the sentence, and leaves years chosen by hand alone', () => {
    let s: Session = { category: 'music', raw: '', conditions: { tags: [], excluded: [] }, excludedIds: [], revision: 0 };
    s = changeText(s, '90년대 노래'); expect(s.years).toEqual({ from: 1990, to: 1999 });
    s = changeText(s, '비 오는 밤'); expect(s.years).toBeUndefined();
    s = changeText({ ...s, years: { from: 2000 }, yearsFromText: false }, '잔잔한 노래'); expect(s.years).toEqual({ from: 2000 });
  });
});

describe('recommendation invariants', () => {
  it('never recommends items excluded by ingredients, and 해산물 blocks every recorded fish ingredient', () => {
    const result = recommend(session({ conditions: { tags: ['저녁'], excluded: ['밀', '해산물'] } }), emptyProfile());
    expect(result.length).toBeGreaterThan(0);
    result.forEach(r => { expect(r.item.ingredients).not.toContain('밀'); expect(r.item.ingredients).not.toContain('생선'); expect(r.item).not.toHaveProperty('cost'); });
  });
  it('only applies temporary feedback to the current session', () => {
    const original = session(); const profile = emptyProfile();
    const first = recommend(original, profile)[0].item.id;
    const next = updateFeedback(profile, original, first, 'session');
    expect(next.profile).toEqual(profile);
    expect(recommend(next.session, next.profile).some(r => r.item.id === first)).toBe(false);
    expect(recommend(session(), next.profile).some(r => r.item.id === first)).toBe(true);
  });
  it('persists long-term feedback without disliking related tags or items', () => {
    const original = session(); const profile = { ...emptyProfile(), selected: ['f01'], tags: ['담백함'] };
    const next = updateFeedback(profile, original, 'f01', 'long');
    expect(next.profile.disliked).toEqual(['f01']); expect(next.profile.tags).toEqual(['담백함']);
    expect(recommend(session(), next.profile).some(r => r.item.id === 'f01')).toBe(false);
    expect(recommend(session(), next.profile).some(r => r.item.tags.includes('담백함'))).toBe(true);
  });
  it('keeps food and music results separate with the specified counts', () => {
    expect(recommend(session(), emptyProfile())).toHaveLength(3);
    const songs = recommend(session({ category: 'music' }), emptyProfile());
    expect(songs).toHaveLength(5); songs.forEach(r => expect(r.item.category).toBe('music'));
  });
  it('returns no matches instead of silently relaxing hard exclusions', () => {
    const profile = { ...emptyProfile(), disliked: ['f02', 'f03', 'f16'] };
    expect(recommend(session({ conditions: { tags: [], excluded: ['밀', '생선', '매콤함'] } }), profile)).toEqual([]);
  });
  it('does not interpret not spicy as a spicy preference', () => {
    const value = parseConditions('혼자 먹을 안 매운 저녁, 땅콩 제외', 'food');
    expect(value.tags).toContain('혼자'); expect(value.tags).not.toContain('매콤함');
    expect(value.excluded).toEqual(['매콤함', '땅콩']);
  });
  it('excludes vocals and keeps study intent in music input', () => {
    const value = parseConditions('과제할 때 보컬 없는 차분한 음악', 'music');
    expect(value.excluded).toContain('보컬'); expect(value.tags).toContain('과제');
    recommend(session({ category: 'music', conditions: value }), emptyProfile()).forEach(r => expect(r.item.tags).not.toContain('보컬'));
  });
});

describe('discovery and reasons', () => {
  const liked = ['m06', 'm07', 'm08', 'm12', 'm01'];
  const study = session({ category: 'music', conditions: { tags: ['과제', '연주곡'], excluded: [] } });
  it('shows at most one registered song while new ones still fit the request (was 3 of 5)', () => {
    const songs = recommend(study, { ...emptyProfile(), selected: liked });
    expect(songs).toHaveLength(5);
    expect(songs.filter(r => liked.includes(r.item.id)).length).toBeLessThanOrEqual(2);
    expect(songs.filter(r => liked.includes(r.item.id) && r.tasteReason === '내 취향에 등록한 곡이에요')).toHaveLength(songs.filter(r => liked.includes(r.item.id)).length);
    songs.forEach(r => expect(r.item.tags.some(t => ['과제', '연주곡'].includes(t))).toBe(true));
  });
  it('keeps pinned favourites and puts extra ones before off-topic candidates', () => {
    const ids = capFamiliar([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], ['a', 'b'], new Set(), i => i.id !== 'd').map(i => i.id);
    expect(ids).toEqual(['a', 'c', 'b', 'd']);
    expect(capFamiliar([{ id: 'a' }, { id: 'b' }, { id: 'c' }], ['a', 'b'], new Set(['a', 'b'])).map(i => i.id)).toEqual(['a', 'b', 'c']);
  });
  it('never claims a taste without one, and explains what sets each card apart', () => {
    const food = recommend(session({ conditions: { tags: ['혼자', '저녁'], excluded: ['매콤함'] } }), emptyProfile());
    food.forEach(r => expect(r.tasteReason).toBe(NO_TASTE_REASON));
    // The difference between cards lives in `contrast`, computed for the set actually shown.
    expect(new Set(food.map(r => `${r.contextReason} ${r.contrast ?? ''}`)).size).toBeGreaterThan(1);
  });
  it('marks how a card meets each condition, and 해산물 only in part', () => {
    const dakgomtang = items.find(i => i.id === 'f02')!;
    const checks = conditionChecks(dakgomtang, { tags: ['혼자', '점심'], excluded: ['매콤함', '해산물'] });
    expect(checks).toEqual([
      { label: '혼자', value: '혼자', kind: 'want', state: 'met' }, { label: '점심', value: '점심', kind: 'want', state: 'untagged' },
      { label: '맵지 않음', value: '매콤함', kind: 'exclude', state: 'met' }, { label: '해산물 일부 확인', value: '해산물', kind: 'exclude', state: 'partial' }]);
    // A missing tag is "not registered", never "does not fit": the reason may still say it fits. An exclusion is applied
    // on the registered data only, and a partial one never reads as applied.
    expect(checks.map(checkText)).toEqual(['혼자 맞음', '점심: 등록 정보 없음', '맵지 않음, 등록 정보 기준 적용', '해산물 제외 일부만 확인']);
    expect(checkText(checks[3])).not.toContain('적용');
  });
});

describe('the evidence line on a card', () => {
  const want = (state: 'met' | 'untagged') => ({ label: 't', value: 't', kind: 'want' as const, state });
  const none = { aiPick: false, storeFound: false };
  it('counts wanted conditions only and names the registered data', () => {
    expect(evidenceText([want('met'), want('untagged'), { label: 'x 제외', value: 'x', kind: 'exclude', state: 'met' }], none)).toBe('조건 2개 중 1개 확인 · 등록 정보 기준');
  });
  it('says nothing about registered data when no condition was given', () => {
    expect(evidenceText([], none)).toBe('');
  });
  it('never presents an AI pick as registered data', () => {
    expect(evidenceText([want('met')], { aiPick: true, storeFound: false })).toBe('조건 1개 중 1개 확인 · AI 추정');
    expect(evidenceText([], { aiPick: true, storeFound: true })).toBe('AI 추천 · Apple Music에서 찾은 곡');
  });
});
