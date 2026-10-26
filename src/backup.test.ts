import {describe,it,expect} from 'vitest';
import {createBackup,parseBackup} from './backup';
import {emptyStore,nextBatch,emptyProfile} from './domain';
import {newSession} from './sessionStorage';
import {recordRound} from './history';
describe('full replacement backup validation',()=>{
  it('round-trips complete stored snapshots and accepts v1 migration',()=>{const s=nextBatch(newSession(),emptyProfile());const store={...emptyStore(),favorites:['f01'],history:recordRound([],s,s.snapshot!)};expect(parseBackup(createBackup(store)).store).toEqual(store);expect(parseBackup(JSON.stringify({...emptyStore(),version:1})).store.version).toBe(2);});
  it('rejects wrong versions, category ids, duplicate ids, malformed objects and oversize',()=>{
    expect(()=>parseBackup('{')).toThrow();expect(()=>parseBackup(JSON.stringify({...emptyStore(),version:3}))).toThrow();
    expect(()=>parseBackup(createBackup({...emptyStore(),favorites:['missing']}))).toThrow('ID');expect(()=>parseBackup(createBackup({...emptyStore(),favorites:['f01','f01']}))).toThrow();
    const store=emptyStore();store.profiles.food.selected=['m01'];expect(()=>parseBackup(createBackup(store))).toThrow();
    expect(()=>parseBackup(' '.repeat(5000001))).toThrow('5MB');
    expect(()=>parseBackup(JSON.stringify({app:'other',backupVersion:1,exportedAt:new Date().toISOString(),data:emptyStore()}))).toThrow();
  });
  it('rejects malformed optional history and item fields before rendering',()=>{const s=nextBatch(newSession(),emptyProfile()),entry=recordRound([],s,s.snapshot!)[0];expect(()=>parseBackup(createBackup({...emptyStore(),history:[{...entry,trimmedRounds:{} as any}]}))).toThrow();const bad=structuredClone(entry);(bad.rounds[0].results[0].item as any).price=[];expect(()=>parseBackup(createBackup({...emptyStore(),history:[bad]}))).toThrow();expect(()=>parseBackup(createBackup({...emptyStore(),appearance:{mode:'dark',accent:'unsafe'} as any}))).toThrow();});
});
describe('data saved before price and budget were removed',()=>{
  // A backup or stored history from the old app: budgets in conditions, prices on items, a budget preset.
  const legacy=()=>{
    const s=nextBatch({...newSession(),raw:'혼자 먹을 만원 이하 저녁'},emptyProfile());
    const entry=recordRound([],s,s.snapshot!)[0] as any;
    entry.conditions={tags:['혼자','저녁'],excluded:[],maxPrice:10000};
    entry.rounds[0].conditions={...entry.conditions};
    entry.rounds[0].results[0].item={...entry.rounds[0].results[0].item,subtitle:'9,000–12,000원',price:'9,000–12,000원',cost:10000};
    entry.selected={result:entry.rounds[0].results[0],date:entry.date,roundId:entry.rounds[0].id};
    return {...emptyStore(),favorites:['f01'],history:[entry],presets:[{id:'p1',category:'food',name:'만원 이하 점심',conditions:{tags:['점심'],excluded:[],maxPrice:10000}}]};
  };
  it('restores without errors, keeps the sentence and unrelated data, and brings back no budget or price',()=>{
    const {store}=parseBackup(createBackup(legacy() as any));
    const [h]=store.history;
    expect(h.raw).toBe('혼자 먹을 만원 이하 저녁');
    expect(store.favorites).toEqual(['f01']);
    expect(h.conditions).toEqual({tags:['혼자','저녁'],excluded:[]});
    expect(h.rounds[0].conditions).toEqual({tags:['혼자','저녁'],excluded:[]});
    for(const item of [h.rounds[0].results[0].item,h.selected!.result.item]){expect(item).not.toHaveProperty('price');expect(item).not.toHaveProperty('cost');expect(item.subtitle).not.toMatch(/원/);}
    expect(store.presets![0].conditions).toEqual({tags:['점심'],excluded:[]});
    expect(JSON.stringify(store)).not.toMatch(/maxPrice|"price"|"cost"/);
  });
});
