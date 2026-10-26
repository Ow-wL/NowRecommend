import { expect, it } from 'vitest';
import { items, validateCatalog } from './data';
import { eligibleCandidates, emptyConditions, emptyProfile, parseConditions } from './domain';
it('catalog IDs, fields, tag vocabulary, search URLs are valid and items carry no price',()=>{expect(validateCatalog()).toEqual([]);expect(validateCatalog([...items,items[0]])).not.toEqual([]);});
it.each([['food','담백한 저녁'],['food','만원 이하 점심'],['music','과제할 때 연주곡'],['music','활기찬 산책']])('retains candidates for representative %s: %s',(category,text)=>{
  const c=category as 'food'|'music';
  const candidates=eligibleCandidates({category:c,raw:text,conditions:parseConditions(text,c),excludedIds:[],revision:0},emptyProfile());
  expect(candidates.length).toBeGreaterThanOrEqual(c === 'food' ? 3 : 5);
});
