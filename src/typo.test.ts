import { expect, it } from 'vitest';
import { applySuggestion, jamo, knownForms, nearSyllable, typoSuggestions } from './typo';
it('takes syllables apart and judges a slip by the first consonant or one jamo', () => {
  expect(jamo('뜻')).toEqual(['ㄸ', 'ㅡ', 'ㅅ']);
  expect(jamo('a')).toEqual(['a']);
  expect(nearSyllable('뚫', '뜻')).toBe(true);   // same ㄸ
  expect(nearSyllable('믈', '물')).toBe(true);   // same ㅁ
  expect(nearSyllable('뜻', '뜻')).toBe(false);
  expect(nearSyllable('밥', '국')).toBe(false);
});
it('offers the known word one syllable away, and leaves correct or unrelated words alone', () => {
  expect(typoSuggestions('비 오는 저녁에 혼자 먹을 따뚫한 국믈, 맵지 않게', 'food')).toEqual([{ from: '따뚫한', to: '따뜻한' }, { from: '국믈', to: '국물' }]);
  expect(typoSuggestions('혼자 먹을 담백한 저녁', 'food')).toEqual([]);
  expect(typoSuggestions('혼잡한 시장에서 먹을 국물', 'food')).toEqual([]);  // 혼잡한 is not 혼자 + a particle
  expect(typoSuggestions('담벡함이 좋아요', 'food')).toEqual([{ from: '담벡함이', to: '담백함이' }]);
  expect(typoSuggestions('과제할 때 차븐한 연주곡', 'music')).toEqual([{ from: '차븐한', to: '차분한' }]);
  expect(knownForms('food')).toEqual(expect.arrayContaining(['따뜻한', '따뜻하게', '국물', '매콤함']));
  expect(knownForms('music')).toEqual(expect.arrayContaining(['활기찬', '연주곡']));
});
it('replaces only that word in the sentence', () => {
  expect(applySuggestion('비 오는 저녁, 따뚫한 국믈 먹고 싶어', { from: '국믈', to: '국물' })).toBe('비 오는 저녁, 따뚫한 국물 먹고 싶어');
  expect(applySuggestion('따뚫한 국믈', { from: '따뚫한', to: '따뜻한' })).toBe('따뜻한 국믈');
});
