import { expect, it } from 'vitest';
import { conditionLabels, shareText } from './share';
it('writes the request, the items and the conditions, and nothing about the account or history', () => {
  const text = shareText({ title: '비 오는 저녁 따뜻한 국물', items: [
    { name: '쌀국수', subtitle: '담백함 · 국물', category: 'food' }, { name: '우동', subtitle: '담백함', category: 'food' }], conditions: conditionLabels({ tags: ['저녁', '국물'], excluded: ['매콤함'] }) });
  expect(text).toBe('지금 추천 · 비 오는 저녁 따뜻한 국물\n1. 쌀국수\n2. 우동\n조건: 저녁 · 국물 · 매콤함 제외');
  expect(shareText({ title: '오늘의 선택', items: [{ name: 'Kiss the Rain', subtitle: '이루마', category: 'music' }] })).toBe('지금 추천 · 오늘의 선택\nKiss the Rain – 이루마');
});
