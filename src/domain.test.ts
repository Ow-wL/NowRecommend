import { describe, expect, it } from 'vitest';
import { capFamiliar, conditionChecks, emptyConditions, emptyProfile, NO_TASTE_REASON, parseConditions, recommend, updateFeedback, type Session } from './domain';
import { items } from './data';
const session = (changes: Partial<Session> = {}): Session => ({ category: 'food', raw: '', conditions: emptyConditions(), excludedIds: [], revision: 0, ...changes });
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
    expect(conditionChecks(dakgomtang, { tags: ['혼자', '점심'], excluded: ['매콤함', '해산물'] })).toEqual([
      { label: '혼자', state: 'met' }, { label: '점심', state: 'unmet' }, { label: '맵지 않음', state: 'met' }, { label: '해산물 일부 확인', state: 'partial' }]);
  });
});
