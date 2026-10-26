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
  let session: Session = {...request(),conditions:{tags:[],excluded:['밀','해산물']},excludedIds:['f02']};
  for(let i=0;i<10;i++) {
    session=nextBatch(session,profile);
    recommend(session,profile).forEach(r=>{expect(r.item.ingredients).not.toContain('밀');expect(r.item.ingredients).not.toContain('생선');expect(['f14','f02']).not.toContain(r.item.id);});
  }
});
it('ignores a budget left in old conditions: price never filters', () => {
  const legacy={...request(),conditions:{tags:[],excluded:[],maxPrice:100} as Session['conditions']};
  expect(candidateInfo(legacy,emptyProfile()).count).toBe(eligibleCandidates(request(),emptyProfile()).length);
});
it('keeps a zero-candidate request empty through repeated batches', () => {
  const profile={...emptyProfile(),disliked:['f02','f03','f16']};
  const session=nextBatch({...request(),conditions:{...emptyConditions(),excluded:['밀','생선','매콤함']}},profile);
  expect(session.currentIds).toEqual([]);expect(candidateInfo(session,profile).count).toBe(0);
});
