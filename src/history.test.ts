import { afterEach, expect, it, vi } from 'vitest';
import { emptyProfile, emptyStore, nextBatch, recommend } from './domain';
import { recordRound, selectResult } from './history';
import { newSession } from './sessionStorage';
import { decodeStore, readStoreResult, writeStore } from './storage';
afterEach(()=>vi.unstubAllGlobals());
it('groups rerolls under one session, saves immutable reasons and deduplicates repeated records',()=>{
  const first=nextBatch(newSession(),emptyProfile());const results=recommend(first,emptyProfile());
  const history=recordRound([],first,results);expect(recordRound(history,first,results)).toEqual(history);
  const next=nextBatch(first,emptyProfile());const grouped=recordRound(history,next,recommend(next,emptyProfile()));
  expect(grouped).toHaveLength(1);expect(grouped[0].rounds).toHaveLength(2);
  results[0].tasteReason='changed';expect(grouped[0].rounds[0].results[0].tasteReason).not.toBe('changed');
  expect(recommend(first,{...emptyProfile(),tags:['재즈']})[0].tasteReason).toBe(first.snapshot![0].tasteReason);
});
it('allows final selection changes without duplicating the session or learning preferences',()=>{
  const request=nextBatch(newSession(),emptyProfile());const history=recordRound([],request,request.snapshot!);
  const chosen=selectResult(history[0],request.snapshot![0],request.roundId!);
  expect(selectResult(chosen,request.snapshot![0],request.roundId!)).toBe(chosen);
  expect(selectResult(chosen,request.snapshot![1],request.roundId!).selected!.result.item.id).toBe(request.snapshot![1].item.id);
});
it('limits details to ten rounds and preserves final choice summary',()=>{
  let session=nextBatch(newSession(),emptyProfile());let history=recordRound([],session,session.snapshot!);
  history[0]=selectResult(history[0],session.snapshot![0],session.roundId!);const choice=structuredClone(history[0].selected);
  for(let i=0;i<12;i++){session=nextBatch(session,emptyProfile());history=recordRound(history,session,session.snapshot!);}
  expect(history[0].rounds).toHaveLength(10);expect(history[0].trimmedRounds).toBe(3);expect(history[0].selected).toEqual(choice);
});
it('migrates legacy entries without recalculating missing historical reasons',()=>{
  const old={...emptyStore(),version:1,history:[{id:'old',date:'2026-10-01T00:00:00Z',category:'food',raw:'옛 요청',conditions:{tags:[],excluded:[],maxPrice:null},resultIds:['f01']}]};
  const migrated=decodeStore(JSON.stringify(old))!;
  expect(migrated.version).toBe(2);expect(migrated.history[0].legacy).toBe(true);expect(migrated.history[0].rounds).toEqual([]);expect(migrated.history[0].resultIds).toEqual(['f01']);
});
it('retains the original v1 JSON before overwriting with a migrated store',()=>{
  const map=new Map([['nowrecommend-prototype-v1',JSON.stringify({...emptyStore(),version:1})]]);
  const before=map.get('nowrecommend-prototype-v1');
  vi.stubGlobal('localStorage',{getItem:(k:string)=>map.get(k)||null,setItem:(k:string,v:string)=>map.set(k,v)});
  expect(writeStore(readStoreResult().store)).toBe(true);expect(map.get('nowrecommend-prototype-v1-backup')).toBe(before);
});
it('rejects malformed snapshots and exposes damaged data for recovery',()=>{
  vi.stubGlobal('localStorage',{getItem:()=>'{broken'});
  expect(readStoreResult().issue).toBe('damaged');expect(readStoreResult().raw).toBe('{broken');
  const store=emptyStore();const request=nextBatch(newSession(),emptyProfile());store.history=recordRound([],request,request.snapshot!);
  (store.history[0].rounds[0].results[0] as any).item.tags=42;
  expect(decodeStore(JSON.stringify(store))).toBeNull();
});
