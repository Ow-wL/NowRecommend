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
});
