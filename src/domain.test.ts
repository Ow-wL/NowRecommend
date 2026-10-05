import { describe, expect, it } from 'vitest';
import { emptyConditions, emptyProfile, parseConditions, recommend, updateFeedback, type Session } from './domain';
const session = (changes: Partial<Session> = {}): Session => ({ category: 'food', raw: '', conditions: emptyConditions(), excludedIds: [], revision: 0, ...changes });
describe('recommendation invariants', () => {
  it('never recommends items excluded by ingredients or budget', () => {
    const result = recommend(session({ conditions: { tags: ['저녁'], excluded: ['밀', '생선'], maxPrice: 10000 } }), emptyProfile());
    expect(result.length).toBeGreaterThan(0);
    result.forEach(r => { expect(r.item.ingredients).not.toContain('밀'); expect(r.item.ingredients).not.toContain('생선'); expect(r.item.cost).toBeLessThanOrEqual(10000); });
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
    expect(recommend(session({ conditions: { tags: [], excluded: [], maxPrice: 1 } }), emptyProfile())).toEqual([]);
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
