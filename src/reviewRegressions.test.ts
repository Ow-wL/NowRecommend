import { describe, expect, it } from 'vitest';
import { emptyConditions, emptyProfile, eligibleCandidates, nextBatch, parseConditions, recommend, replaceCandidate, unsupportedConditions, withContrast, type Session } from './domain';
import { items } from './data';
import { recordRound } from './history';

// Cases from the strict review of 2026-10-27 (artifacts/strict-review/REVIEW.md), kept as regular regression tests.
const request = (changes: Partial<Session> = {}): Session => ({ category: 'food', raw: '', conditions: emptyConditions(), excludedIds: [], revision: 0, ...changes });
const unseen = (s: Session) => eligibleCandidates(s, emptyProfile()).filter(i => !s.seenIds?.includes(i.id));

describe('exclusions are applied or reported, never dropped', () => {
  it('excludes sesame, a recorded ingredient of 비빔밥', () => {
    const raw = '혼자 먹을 점심, 참깨는 빼줘';
    const conditions = parseConditions(raw, 'food');
    expect(conditions).toEqual({ tags: ['혼자', '점심'], excluded: ['참깨'] });
    const results = recommend(request({ raw, conditions }), emptyProfile());
    expect(results).toHaveLength(3);
    results.forEach(r => expect(r.item.ingredients).not.toContain('참깨'));
  });
  it('can exclude every ingredient the catalog records', () => {
    for (const ingredient of new Set(items.flatMap(i => i.ingredients))) {
      expect(parseConditions(`${ingredient} 빼줘`, 'food').excluded, ingredient).toContain(ingredient);
    }
  });
  it('reports words it cannot exclude, and does not read them as wanted tags', () => {
    expect(unsupportedConditions('오이랑 고수 빼줘', 'food').map(u => u.text)).toEqual(['오이 제외', '고수 제외']);
    expect(parseConditions('채소 빼고 따뜻한 거', 'food').tags).toEqual(['따뜻함']);
    // 채소 is a catalog trait that cannot be excluded (not a missing ingredient): reported as such.
    expect(unsupportedConditions('채소 빼고 따뜻한 거', 'food')).toEqual([{ kind: 'trait', text: '채소 제외' }]);
  });
});

describe('unseen candidates come before repeats', () => {
  it('keeps showing unseen candidates for 국물 until none is left (was a repeat with 11 unseen)', () => {
    const profile = emptyProfile();
    let s = request({ raw: '국물', conditions: { tags: ['국물'], excluded: [] } });
    const rounds: string[][] = [];
    while (unseen(s).length) { s = nextBatch(s, profile); rounds.push(s.currentIds!); expect(s.batchNewCount).toBeGreaterThan(0); }
    // Matching cards first, then the others; nothing repeats before all 16 eligible menus were shown.
    expect(rounds[0]).toEqual(['f01', 'f02', 'f04']);
    expect(rounds[1].slice(0, 2)).toEqual(['f08', 'f09']);
    expect(new Set(rounds.flat()).size).toBe(16);
    expect(nextBatch(s, profile).batchNewCount).toBe(0); // only now is everything seen
  });
  it('keeps a pinned card first and never relaxes a hard exclusion while reordering', () => {
    const p = emptyProfile(), first = nextBatch(request({ conditions: { tags: [], excluded: ['밀'] } }), p);
    const pinned = first.currentIds![2];
    const second = nextBatch({ ...first, pinnedIds: [pinned], conditions: { tags: ['국물'], excluded: ['밀'] } }, p);
    expect(second.currentIds![0]).toBe(pinned);
    recommend(second, p).forEach(r => expect(r.item.ingredients).not.toContain('밀'));
  });
});

describe('comparisons describe the cards actually shown', () => {
  const setReasonsAreTrue = (results: ReturnType<typeof recommend>) => {
    for (const r of results) for (const [tag, word] of [['따뜻함', '따뜻한'], ['채소', '채소가 많은'], ['차가움', '차가운'], ['담백함', '담백한'], ['고소함', '고소한']] as const)
      if (r.contrast?.includes(word)) expect(results.filter(o => o.item.tags.includes(tag)).map(o => o.item.name)).toEqual([r.item.name]);
  };
  it('recomputes every card after a one-card replacement', () => {
    const p = emptyProfile(), first = nextBatch(request({ raw: '채소', conditions: { tags: ['채소'], excluded: [] } }), p);
    expect(first.currentIds).toEqual(['f07', 'f10', 'f12']);
    const changed = replaceCandidate(first, p, 'f07')!;
    const shown = recommend(changed, p);
    expect(shown.map(r => r.item.name)).toEqual(['채소 카레', '샌드위치', '두부 덮밥']);
    setReasonsAreTrue(shown);
    expect(shown.find(r => r.item.name === '두부 덮밥')?.contrast).toBe('추천 중 유일하게 고소한 메뉴예요.');
    expect(shown.find(r => r.item.name === '채소 카레')?.contrast).toBeUndefined();
    expect(changed.snapshot).toEqual(shown); // what is stored (history, selection) is what is shown
  });
  it('keeps each history round as it was shown then', () => {
    const p = emptyProfile(), first = nextBatch(request({ raw: '채소', conditions: { tags: ['채소'], excluded: [] } }), p);
    const changed = replaceCandidate(first, p, 'f07')!;
    const history = recordRound(recordRound([], first, first.snapshot!), changed, changed.snapshot!);
    const [before, after] = history[0].rounds;
    expect(before.results.find(r => r.item.id === 'f12')?.contrast).toBe('추천 중 유일하게 따뜻한 메뉴예요.'); // 비빔밥 was also 고소한 then
    expect(after.results.find(r => r.item.id === 'f12')?.contrast).toBe('추천 중 유일하게 고소한 메뉴예요.');
  });
  it('recomputes when a card leaves the set, whatever the reasons were written for', () => {
    const p = emptyProfile(), s = nextBatch(request({ raw: '채소', conditions: { tags: ['채소'], excluded: [] } }), p);
    const after = recommend({ ...s, excludedIds: ['f10'] }, p);
    setReasonsAreTrue(after);
    expect(withContrast(after)).toEqual(after);
  });
});

describe('a replacement is not a repeat', () => {
  it('counts no card as shown again after replacing one in a fresh round', () => {
    const p = emptyProfile(), first = nextBatch(request({ raw: '채소', conditions: { tags: ['채소'], excluded: [] } }), p);
    const changed = replaceCandidate(first, p, 'f07')!;
    expect(changed.repeatIds).toEqual([]);
    expect(changed.batchNewCount).toBe(3);
  });
});

describe('negated phrases are never read as wanted (second review)', () => {
  it.each([['국물 있는 건 빼줘', '국물', '국물'], ['고소한 건 빼줘', '고소함', '고소함']])('%s', (raw, tag, label) => {
    const conditions = parseConditions(raw, 'food');
    expect(conditions.tags).not.toContain(tag);
    expect(unsupportedConditions(raw, 'food')).toEqual([{ kind: 'trait', text: `${label} 제외` }]);
    // Nothing favours the unwanted trait any more: with no wanted tag the order is the plain catalog order.
    expect(recommend(request({ raw, conditions }), emptyProfile()).map(r => r.item.id)).toEqual(['f01', 'f02', 'f03']);
  });
  it('applies an excludable trait in a negated phrase', () => {
    expect(parseConditions('매콤한 거 말고 따뜻한 국물', 'food')).toEqual({ tags: ['따뜻함', '국물'], excluded: ['매콤함'] });
  });
  it('keeps every item of a comma list: applied or reported', () => {
    const raw = '혼자 먹을 점심, 고수, 참깨 빼줘';
    expect(parseConditions(raw, 'food')).toEqual({ tags: ['혼자', '점심'], excluded: ['참깨'] });
    expect(unsupportedConditions(raw, 'food')).toEqual([{ kind: 'ingredient', text: '고수 제외' }]);
  });
  it('reads one-letter ingredients from an explicit list only', () => {
    expect(parseConditions('깨 빼주세요', 'food').excluded).toEqual(['참깨']);
    expect(unsupportedConditions('파 빼줘', 'food')).toEqual([{ kind: 'ingredient', text: '파 제외' }]);
    expect(parseConditions('깨끗한 거 빼고 담백한 저녁', 'food').excluded).toEqual([]);
  });
});

describe('one-letter ingredients keep working with a particle (third review)', () => {
  it('applies 깨는 빼줘 and keeps 비빔밥 out', () => {
    const raw = '혼자 먹을 점심, 깨는 빼줘', conditions = parseConditions(raw, 'food');
    expect(conditions.excluded).toEqual(['참깨']);
    recommend(request({ raw, conditions }), emptyProfile()).forEach(r => expect(r.item.ingredients).not.toContain('참깨'));
  });
  it('reports 파는 빼줘', () => {
    expect(unsupportedConditions('혼자 먹을 점심, 파는 빼줘', 'food')).toEqual([{ kind: 'ingredient', text: '파 제외' }]);
  });
});
