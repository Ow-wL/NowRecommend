import { describe, expect, it } from 'vitest';
import { items, type Category } from './data';
import { AXES, axisLeans, codeFromItems, codeFromScores, compareTypes, parseShared, percentsOf, relatedTypes, requestForType, scoresFromAnswers, shareSearch, sides, statements, togetherItems, TYPE_NAMES, typeName, typeProfile, type Answer } from './tasteType';
import { healthTerms } from './sensitive';
import { options } from './data';

const every = (c: Category) => AXES[c].reduce((codes, a) => codes.flatMap(x => [x + a.a, x + a.b]), ['']);
describe('taste type', () => {
  for (const c of ['food', 'music'] as Category[]) {
    it(`names and describes all 16 ${c} codes, with six balanced statements per axis and known tags`, () => {
      expect(every(c)).toHaveLength(16);
      for (const code of every(c)) expect(TYPE_NAMES[c][code]).toBeTruthy();
      expect(Object.keys(TYPE_NAMES[c])).toHaveLength(16);
      const list = statements(c);
      expect(list).toHaveLength(24);
      for (let n = 0; n < 4; n++) for (const key of ['a', 'b']) expect(list.filter(s => s.axis === n && s.key === key)).toHaveLength(3);
      expect(new Set(list.map(s => s.text)).size).toBe(24);
      for (const code of every(c)) {
        const p = typeProfile(c, code)!;
        expect([p.line, p.summary, p.together, p.tip].every(Boolean)).toBe(true);
        expect([p.traits.length, p.strengths.length, p.cautions.length, p.happy.length, p.sayings.length, p.picks.length]).toEqual([4, 3, 3, 2, 2, 3]);
        // No word of the test may itself ask for the health consent (src/sensitive.ts).
        expect(healthTerms(p.line, p.summary, p.together, p.tip, ...p.traits, ...p.strengths, ...p.cautions, ...p.happy, ...p.sayings, ...p.picks)).toEqual([]);
      }
      expect(healthTerms(...list.map(s => s.text))).toEqual([]);
      for (const code of every(c)) for (const t of requestForType(c, code).conditions.tags) expect(options[c]).toContain(t);
    });
  }
  it('reads the code from how strongly each statement is agreed with', () => {
    const toward = (c: Category, side: 'a' | 'b') => statements(c).map(s => (s.key === side ? 2 : -2) as Answer);
    expect(scoresFromAnswers('food', toward('food', 'a'))).toEqual([100, 100, 100, 100]);
    expect(codeFromScores('food', scoresFromAnswers('food', toward('food', 'a')))).toBe('SHTA');
    expect(codeFromScores('food', scoresFromAnswers('food', toward('food', 'b')))).toBe('MLNG');
    const agreeAll = statements('music').map(() => 2 as Answer);  // agreeing with everything leans nowhere
    expect(scoresFromAnswers('music', agreeAll)).toEqual([50, 50, 50, 50]);
    expect(codeFromScores('music', [50, 49, 80, 10])).toBe('EIRB');  // an even axis goes to its first side
    const mild = statements('food').map(s => (s.axis === 0 ? (s.key === 'a' ? 1 : 0) : 0) as Answer);
    expect(scoresFromAnswers('food', mild)[0]).toBe(63);  // three mild agreements of six statements
  });
  it('needs a few liked items to read a type from them', () => {
    expect(codeFromItems('food', items.filter(i => i.category === 'food').slice(0, 2))).toBeUndefined();
    const spicy = items.filter(i => i.category === 'food' && i.tags.includes('매콤함')).slice(0, 3);
    expect(codeFromItems('food', spicy)?.[0]).toBe('S');
    const old = [1980, 1985, 1990].map(releaseYear => ({ tags: ['차분함', '연주곡'], releaseYear }));
    expect(codeFromItems('music', old)).toMatch(/^CIR/);
  });
  it('turns a type into a request: words for the AI, tags and years to check', () => {
    expect(typeName('food', 'SHTA')).toBe('혼밥 국밥 장인');
    expect(sides('music', 'CINB').map(s => s.letter)).toEqual(['C', 'I', 'N', 'B']);
    const food = requestForType('food', 'SLNG');
    expect(food.conditions.tags).toEqual(['매콤함', '채소', '함께']);
    expect(food.raw).toContain('새로운 메뉴');
    expect(requestForType('music', 'CIRF', 2026).years).toEqual({ to: 2016 });
    expect(requestForType('music', 'CINF', 2026).years).toEqual({ from: 2024 });
  });
  it('shows how far each axis leans, from the new scores or the old counts alike', () => {
    expect(percentsOf({ scores: [63, 100, 20, 50] })).toEqual([63, 100, 20, 50]);
    expect(percentsOf({ counts: [2, 4, 3, 1] })).toEqual([50, 100, 75, 25]);  // a result from the two-choice test
    expect(percentsOf({})).toBeUndefined();
    expect(axisLeans('food', [50, 100, 75, 25]).map(l => l.aPercent)).toEqual([50, 100, 75, 25]);
    expect(axisLeans('food')).toEqual([]);
  });
  it('asks for neither side of an axis that hardly leans', () => {
    expect(requestForType('food', 'SHTA', 2026, [54, 100, 100, 100]).conditions.tags).toEqual(['고소함', '혼자']);
    expect(requestForType('food', 'SHTA', 2026, [58, 100, 100, 100]).conditions.tags).toEqual(['매콤함', '고소함', '혼자']);
    expect(requestForType('music', 'CIRF', 2026, [0, 0, 50, 100]).years).toBeUndefined();
  });
  it('pairs each type with an existing one, and never itself', () => {
    for (const c of ['food', 'music'] as Category[]) for (const code of every(c)) {
      const { best, worst } = relatedTypes(c, code);
      expect(TYPE_NAMES[c][best.code]).toBe(best.name);
      expect(TYPE_NAMES[c][worst.code]).toBe(worst.name);
      expect([best.code, worst.code]).not.toContain(code);
      expect(relatedTypes(c, best.code).best.code).toBe(code);
    }
  });
  it('round-trips a link with the scores, two digits an axis', () => {
    const search = shareSearch({ food: { code: 'SHTA', scores: [72, 100, 55, 61] } });
    expect(search).toBe('?t=f-SHTA-72995561');
    expect(parseShared(search)!.types.food).toEqual({ code: 'SHTA', scores: [72, 99, 55, 61] });
    expect(parseShared('?t=f-SHTA-72994561')).toBeNull();  // 45 is the second side, but the code says the first
  });
  it('round-trips a link, with the name encoded', () => {
    const search = shareSearch({ food: { code: 'SHTA', counts: [3, 4, 3, 3] }, music: { code: 'CIRF' } }, ' 주형 & 친구 ');
    expect(parseShared(search)).toEqual({ name: '주형 & 친구', types: { food: { code: 'SHTA', counts: [3, 4, 3, 3] }, music: { code: 'CIRF' } } });
    expect(shareSearch({ food: { code: 'SHTA' } })).toBe('?t=f-SHTA');
  });
  it('shows nothing for a link it did not write', () => {
    for (const bad of ['', '?t=', '?t=f-XXXX', '?t=x-SHTA', '?t=f-SHTA-3', '?t=f-SHTA-9999', '?t=f-SHTA-0444', '?t=f-SHTA.f-SHTG', '?other=1'])
      expect(parseShared(bad)).toBeNull();
  });
  it('cleans and caps a name from a link', () => {
    expect(parseShared(`?t=f-SHTA&n=${encodeURIComponent('열두글자를넘어가는아주긴이름이에요')}`)!.name).toHaveLength(12);
    expect(parseShared(`?t=f-SHTA&n=${encodeURIComponent('a\u0007b')}`)!.name).toBe('ab');
  });
  it('compares two people: identical is the top, opposite never reads as zero', () => {
    const me = { code: 'SHTA', counts: [4, 4, 4, 4] };
    expect(compareTypes('food', me, me)).toMatchObject({ percent: 100, verdict: '찰떡이에요', different: [] });
    const opposite = compareTypes('food', me, { code: 'MLNG', counts: [0, 0, 0, 0] });
    expect(opposite.percent).toBe(45);
    expect(opposite.same).toEqual([]);
    expect(opposite.different).toHaveLength(4);
    const near = compareTypes('food', { code: 'SHTA', counts: [3, 3, 3, 3] }, { code: 'SHTG', counts: [3, 3, 3, 1] });
    expect(near.percent).toBeGreaterThan(85);
    expect(near.same).toEqual(['자극적인 맛', '든든하게', '익숙한 메뉴']);
    expect(near.different).toEqual([{ mine: '혼자서', theirs: '여럿이' }]);
  });
  it('finds something for two people from what they share', () => {
    const shared = togetherItems('food', { code: 'SHTA' }, { code: 'SLNG' }, items);
    expect(shared.length).toBeGreaterThan(0);
    for (const item of shared) { expect(item.category).toBe('food'); expect(item.tags).toContain('매콤함'); }
  });
});
