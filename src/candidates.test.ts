import { expect, it } from 'vitest';
import { candidateInfo, emptyConditions, emptyProfile, eligibleCandidates, nextBatch, recommend, type Session } from './domain';
const request = (): Session => ({ category:'food', raw:'', conditions:emptyConditions(), excludedIds:[], revision:0 });
it('does not repeat exposed candidates while enough unseen eligible items remain', () => {
  const profile = emptyProfile(); const first = nextBatch(request(),profile);
  const second = nextBatch(first,profile); const third = nextBatch(second,profile);
  expect(second.currentIds!.some(id=>first.currentIds!.includes(id))).toBe(false);
  expect(third.currentIds!.some(id=>second.seenIds!.includes(id))).toBe(false);
  expect(recommend(second,profile).map(r=>r.item.id)).toEqual(second.currentIds);
});
it('reports partial new batches and exhaustion without rotating ranking', () => {
  const profile = emptyProfile(); let session = request();
  for(let i=0;i<5;i++) session=nextBatch(session,profile);
  session=nextBatch(session,profile); expect(session.batchNewCount).toBe(1);
  const exhausted=nextBatch(session,profile); expect(exhausted.batchNewCount).toBe(0);
  expect(nextBatch(exhausted,profile).currentIds).toEqual(exhausted.currentIds);
});
it('never relaxes required exclusions or dislikes during rerolls', () => {
  const profile = {...emptyProfile(),disliked:['f14']};
  let session: Session = {...request(),conditions:{tags:[],excluded:['밀','생선'],maxPrice:10000},excludedIds:['f02']};
  for(let i=0;i<10;i++) {
    session=nextBatch(session,profile);
    recommend(session,profile).forEach(r=>{expect(r.item.ingredients).not.toContain('밀');expect(r.item.ingredients).not.toContain('생선');expect(r.item.cost).toBeLessThanOrEqual(10000);expect(['f14','f02']).not.toContain(r.item.id);});
  }
});
it('computes each budget suggestion as the actual total candidate difference', () => {
  const session={...request(),conditions:{tags:[],excluded:['밀'],maxPrice:8000}};const profile=emptyProfile();
  const info=candidateInfo(session,profile);
  for(const suggestion of info.suggestions) expect(suggestion.gain).toBe(eligibleCandidates({...session,conditions:{...session.conditions,maxPrice:suggestion.price}},profile).length-info.count);
  expect(info.suggestions.length).toBeGreaterThan(0);
});
it('keeps a zero-candidate request empty through repeated batches', () => {
  const session=nextBatch({...request(),conditions:{...emptyConditions(),maxPrice:100}},emptyProfile());
  expect(session.currentIds).toEqual([]);expect(candidateInfo(session,emptyProfile()).count).toBe(0);
});
