import { describe, expect, it } from 'vitest';
import { changeText, conditionConflicts, createEditor, parseConditions, toggleCondition, unsupportedConditions, type Session } from './domain';
const request = (raw = ''): Session => ({ category: 'food', raw, conditions: parseConditions(raw, 'food'), editor: createEditor(raw, 'food'), excludedIds: [], revision: 0 });
describe('supported sentence regression cases', () => {
  // Amounts are recognised only to say price is unsupported (`price`); they never become a condition.
  const cases: [string, 'food' | 'music', string[], string[], string | null][] = [
    ['8천원 이하 점심', 'food', ['점심'], [], '8천원 이하'],
    ['1만 5천원', 'food', [], [], '1만 5천원'],
    ['15,000원 이하', 'food', [], [], '15,000원 이하'],
    ['이만원 이하', 'food', [], [], '이만원 이하'],
    ['만원 이하', 'food', [], [], '만원 이하'],
    ['2만 원 저녁', 'food', ['저녁'], [], '2만 원'],
    ['삼만원', 'food', [], [], '삼만원'],
    ['오천원', 'food', [], [], '오천원'],
    ['가성비 좋은 점심', 'food', ['점심'], [], '가성비'],
    ['예산 맞춰서 저녁', 'food', ['저녁'], [], '예산'],
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
    expect(parsed).not.toHaveProperty('maxPrice');
    expect(unsupportedConditions(text, category).filter(u => u.kind === 'price').map(u => u.text)).toEqual(price ? [price] : []);
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
  it('keeps the other conditions of a sentence that also asks for a price, and adds no budget', () => {
    const next = changeText(request(), '혼자 먹을 만원 이하 저녁, 해산물은 빼고 맵지 않게, 배달 가능한 메뉴');
    expect(next.conditions).toEqual({ tags: ['혼자', '저녁'], excluded: ['매콤함', '해산물'] });
    expect(unsupportedConditions(next.raw, 'food').map(u => u.kind)).toEqual(['price', 'delivery']);
  });
  it('turns a price-only sentence into no condition at all', () => {
    expect(changeText(request(), '만원 이하로 먹고 싶어').conditions).toEqual({ tags: [], excluded: [] });
  });
  it('drops a budget left in a restored editor', () => {
    const legacy = JSON.parse(JSON.stringify({ ...request('만원 이하'), conditions: { tags: [], excluded: [], maxPrice: 10000 }, editor: undefined })) as Session;
    expect(toggleCondition(legacy, '혼자').conditions).toEqual({ tags: ['혼자'], excluded: [] });
  });
  it('shows conflicts instead of silently deleting direct user intent', () => {
    const next = changeText(toggleCondition(request(), '매콤함'), '안 매운 저녁');
    expect(next.conditions.tags).toContain('매콤함');
    expect(next.conditions.excluded).toContain('매콤함');
    expect(conditionConflicts(next).length).toBeGreaterThan(0);
    expect(conditionConflicts(toggleCondition(next, '매콤함'))).toEqual([]);
  });
});
