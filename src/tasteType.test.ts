import { describe, expect, it } from 'vitest';
import { items, type Category } from './data';
import { AXES, codeFromAnswers, codeFromItems, QUESTIONS, requestForType, sides, TYPE_NAMES, typeName } from './tasteType';
import { options } from './data';

const every = (c: Category) => AXES[c].reduce((codes, a) => codes.flatMap(x => [x + a.a, x + a.b]), ['']);
describe('taste type', () => {
  for (const c of ['food', 'music'] as Category[]) {
    it(`names all 16 ${c} codes, with two questions per axis and known tags`, () => {
      expect(every(c)).toHaveLength(16);
      for (const code of every(c)) expect(TYPE_NAMES[c][code]).toBeTruthy();
      expect(Object.keys(TYPE_NAMES[c])).toHaveLength(16);
      expect(AXES[c].map((_, n) => QUESTIONS[c].filter(q => q.axis === n).length)).toEqual([2, 2, 2, 2]);
      for (const code of every(c)) for (const t of requestForType(c, code).conditions.tags) expect(options[c]).toContain(t);
    });
  }
  it('reads the code from the answers; a tie goes to the first answer of that axis', () => {
    expect(codeFromAnswers('food', Array(8).fill('a'))).toBe('SHTA');
    expect(codeFromAnswers('food', Array(8).fill('b'))).toBe('MLNG');
    expect(codeFromAnswers('music', ['a', 'b', 'a', 'b', 'b', 'a', 'b', 'a'])).toBe('EIRB');
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
});
