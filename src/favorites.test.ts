import {it,expect} from 'vitest';
import { emptyProfile, eligibleCandidates, candidateInfo, nextBatch } from './domain';
import {newSession} from './sessionStorage';
it('favorite scope remains strict through filtering, shortage and rerolls',()=>{
  const session={...newSession(),candidateScope:'favorites' as const,candidateIds:['f01','f02','f03'],conditions:{tags:[],excluded:['닭고기','버섯']}};
  expect(eligibleCandidates(session,emptyProfile()).map(i=>i.id)).toEqual(['f01']);
  expect(candidateInfo(session,emptyProfile()).count).toBe(1);
  const first=nextBatch(session,emptyProfile()),second=nextBatch(first,emptyProfile());expect(second.currentIds).toEqual(['f01']);expect(second.batchNewCount).toBe(0);
  expect(eligibleCandidates({...session,candidateIds:[]},emptyProfile())).toEqual([]);
});
