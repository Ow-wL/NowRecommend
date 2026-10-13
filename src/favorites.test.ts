import {it,expect} from 'vitest';
import { emptyProfile, eligibleCandidates, candidateInfo, nextBatch } from './domain';
import {newSession} from './sessionStorage';
it('favorite scope remains strict through filtering, shortage and rerolls',()=>{
  const session={...newSession(),candidateScope:'favorites' as const,candidateIds:['f01','f02','f03'],conditions:{tags:[],excluded:['닭고기'],maxPrice:11000}};
  expect(eligibleCandidates(session,emptyProfile()).map(i=>i.id)).toEqual(['f01']);
  expect(candidateInfo(session,emptyProfile()).suggestions).toEqual([{price:15000,gain:1},{price:16000,gain:1},{price:20000,gain:1}]);
  const first=nextBatch(session,emptyProfile()),second=nextBatch(first,emptyProfile());expect(second.currentIds).toEqual(['f01']);expect(second.batchNewCount).toBe(0);
  expect(eligibleCandidates({...session,candidateIds:[]},emptyProfile())).toEqual([]);
});
