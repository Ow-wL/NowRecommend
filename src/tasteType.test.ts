import { describe, expect, it } from 'vitest';
import { items, type Category } from './data';
import { AXES, axisLeans, codeFromAnswers, codeFromItems, compareTypes, countsFromAnswers, parseShared, QUESTIONS, relatedTypes, requestForType, shareSearch, sides, togetherItems, TYPE_NAMES, TYPE_PROFILES, typeName } from './tasteType';
import { options } from './data';

const every = (c: Category) => AXES[c].reduce((codes, a) => codes.flatMap(x => [x + a.a, x + a.b]), ['']);
describe('taste type', () => {
  for (const c of ['food', 'music'] as Category[]) {
    it(`names and describes all 16 ${c} codes, with four questions per axis and known tags`, () => {
      expect(every(c)).toHaveLength(16);
      for (const code of every(c)) expect(TYPE_NAMES[c][code]).toBeTruthy();
      expect(Object.keys(TYPE_NAMES[c])).toHaveLength(16);
      expect(AXES[c].map((_, n) => QUESTIONS[c].filter(q => q.axis === n).length)).toEqual([4, 4, 4, 4]);
      for (const code of every(c)) { expect(TYPE_PROFILES[c][code].line).toBeTruthy(); expect(TYPE_PROFILES[c][code].about).toBeTruthy(); expect(TYPE_PROFILES[c][code].picks).toHaveLength(3); }
      expect(Object.keys(TYPE_PROFILES[c])).toHaveLength(16);
      expect(new Set(QUESTIONS[c].map(q => q.text)).size).toBe(16);
      for (const code of every(c)) for (const t of requestForType(c, code).conditions.tags) expect(options[c]).toContain(t);
    });
  }
  it('reads the code from the answers; a tie goes to the first answer of that axis', () => {
    expect(codeFromAnswers('food', Array(16).fill('a'))).toBe('SHTA');
    expect(codeFromAnswers('food', Array(16).fill('b'))).toBe('MLNG');
    expect(codeFromAnswers('music', ['a', 'b', 'a', 'b', 'b', 'a', 'b', 'a', 'a', 'b', 'a', 'b', 'a', 'b', 'a', 'b'])).toBe('EIRB');
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
  it('measures each axis from its answers, and a tie shows as half and half', () => {
    const answers = Array(16).fill('a') as ('a' | 'b')[];
    expect(countsFromAnswers('food', answers)).toEqual([4, 4, 4, 4]);
    answers[0] = 'b'; answers[4] = 'b';  // two of the four on the first axis
    expect(countsFromAnswers('food', answers)).toEqual([2, 4, 4, 4]);
    expect(codeFromAnswers('food', answers)[0]).toBe('M');  // the tie goes to the first answer of that axis
    expect(axisLeans('food', [2, 4, 3, 1]).map(l => l.aPercent)).toEqual([50, 100, 75, 25]);
    expect(axisLeans('food')).toEqual([]);
  });
  it('asks for neither side of an axis answered half and half', () => {
    expect(requestForType('food', 'SHTA', 2026, [2, 4, 4, 4]).conditions.tags).toEqual(['고소함', '혼자']);
    expect(requestForType('music', 'CIRF', 2026, [0, 0, 2, 4]).years).toBeUndefined();
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
