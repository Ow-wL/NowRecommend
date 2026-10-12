import { describe, expect, it } from 'vitest';
import { changeBudget, changeText, conditionConflicts, createEditor, emptyConditions, parseConditions, toggleCondition, validateBudget, type Session } from './domain';
const request = (raw = ''): Session => ({ category: 'food', raw, conditions: parseConditions(raw, 'food'), editor: createEditor(raw, 'food'), excludedIds: [], revision: 0 });
describe('supported sentence regression cases', () => {
  const cases: [string, 'food' | 'music', string[], string[], number | null][] = [
    ['8천원 이하 점심', 'food', ['점심'], [], 8000],
    ['1만 5천원', 'food', [], [], 15000],
    ['15,000원 이하', 'food', [], [], 15000],
    ['이만원 이하', 'food', [], [], 20000],
    ['만원 이하', 'food', [], [], 10000],
    ['2만 원 저녁', 'food', ['저녁'], [], 20000],
    ['삼만원', 'food', [], [], 30000],
    ['오천원', 'food', [], [], 5000],
    ['혼자 안 매운 저녁', 'food', ['혼자','저녁'], ['매콤함'], null],
    ['맵지 않은 점심', 'food', ['점심'], ['매콤함'], null],
    ['담백한 저녁', 'food', ['저녁','담백함'], [], null],
    ['친구와 고소한 점심', 'food', ['함께','점심','고소함'], [], null],
    ['따뜻한 국물', 'food', ['따뜻함','국물'], [], null],
    ['시원한 음식, 생선 제외', 'food', ['차가움'], ['생선'], null],
    ['땅콩 제외', 'food', [], ['땅콩'], null],
    ['밀 없이', 'food', [], ['밀'], null],
    ['과제할 때 보컬 없는 음악', 'music', ['과제','연주곡'], ['보컬'], null],
    ['가사 없는 차분한 음악', 'music', ['차분함','연주곡'], ['보컬'], null],
    ['산책할 때 활기찬 음악', 'music', ['산책','활기참'], [], null],
    ['운동할 때 신나는 음악', 'music', ['운동','활기참'], [], null],
    ['휴식하면서 피아노', 'music', ['휴식','피아노'], [], null],
    ['집중할 때 재즈 연주곡', 'music', ['과제','연주곡','재즈'], [], null],
    ['차분한 어쿠스틱', 'music', ['차분함','어쿠스틱'], [], null],
    ['알 수 없는 표현', 'food', [], [], null],
  ];
  it.each(cases)('%s (%s)', (text, category, tags, excluded, price) => {
    const parsed = parseConditions(text, category);
    expect(new Set(parsed.tags)).toEqual(new Set(tags));
    expect(new Set(parsed.excluded)).toEqual(new Set(excluded));
    expect(parsed.maxPrice).toBe(price);
  });
});
describe('condition provenance and validation', () => {
  it('replaces stale automatic conditions while preserving direct choices', () => {
    const first = toggleCondition(request('매운 점심'), '혼자');
    const next = changeText(first, '담백한 저녁');
    expect(next.conditions.tags).toEqual(['저녁','담백함','혼자']);
    expect(next.conditions.tags).not.toContain('점심');
    expect(next.conditions.tags).not.toContain('매콤함');
  });
  it('does not resurrect dismissed automatic tags on repeated confirmation', () => {
    const dismissed = toggleCondition(request('매운 점심'), '매콤함');
    expect(changeText(dismissed, dismissed.raw).conditions.tags).toEqual(['점심']);
    const restored = JSON.parse(JSON.stringify(dismissed)) as Session;
    expect(changeText(restored, restored.raw).conditions.tags).toEqual(['점심']);
  });
  it('preserves direct budget over changing text and supports explicitly clearing it', () => {
    const direct = changeBudget(request('이만원 이하'), '8000');
    expect(changeText(direct, '1만 5천원 이하').conditions.maxPrice).toBe(8000);
    expect(changeBudget(direct, '').conditions.maxPrice).toBeNull();
    expect(changeText(changeBudget(direct,''), '만원').conditions.maxPrice).toBeNull();
  });
  it.each(['-1','hello','1000001','0','1.5','NaN'])('rejects invalid direct budget %s', input => {
    expect(validateBudget(input)).not.toBeNull();
    expect(changeBudget(request(), input).conditions.maxPrice).toBeNull();
  });
  it('shows conflicts instead of silently deleting direct user intent', () => {
    const next = changeText(toggleCondition(request(), '매콤함'), '안 매운 저녁');
    expect(next.conditions.tags).toContain('매콤함');
    expect(next.conditions.excluded).toContain('매콤함');
    expect(conditionConflicts(next).length).toBeGreaterThan(0);
    expect(conditionConflicts(toggleCondition(next, '매콤함'))).toEqual([]);
  });
});
