import { emptyStore, type Store } from './domain';
import { validConditions, validRecommendation } from './sessionStorage';
const KEY = 'nowrecommend-prototype-v1';
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
function validHistory(h: any, version: number): boolean {
  if (!h || typeof h.id !== 'string' || !date(h.date) || !['food','music'].includes(h.category) || typeof h.raw !== 'string' || !strings(h.resultIds) || !validConditions(h.conditions)) return false;
  if(version === 1) return true;
  return Array.isArray(h.rounds) && h.rounds.length <= 10 && h.rounds.every((r: any) => typeof r.id === 'string' && date(r.date) && typeof r.raw === 'string' && validConditions(r.conditions) && Array.isArray(r.results) && r.results.every(validRecommendation) && strings(r.excludedIds) && Array.isArray(r.feedback) && r.feedback.every((f:any) => typeof f.itemId === 'string' && ['session','long'].includes(f.scope) && ['exclude','restore'].includes(f.action) && date(f.date)))
    && (h.selected === undefined || validRecommendation(h.selected.result) && date(h.selected.date) && typeof h.selected.roundId === 'string');
}
export function decodeStore(text: string): Store | null {
  try {
    if(text.length > 5000000) return null;
    const v = JSON.parse(text);
    if (![1,2].includes(v?.version) || typeof v.name !== 'string' || v.name.length > 100 || !['food','music'].every(c => ['selected','tags','disliked'].every(k => strings(v.profiles?.[c]?.[k]))) || !strings(v.favorites) || !Array.isArray(v.history) || v.history.length > 50 || !v.history.every((h:any) => validHistory(h,v.version))) return null;
    return v.version === 2 ? v : { ...v, version:2, history:v.history.map((h:any)=>({...h,rounds:[],legacy:true})) };
  } catch { return null; }
}
export type StoreLoad = { store:Store; issue?: 'damaged'|'unavailable'; raw?:string };
export function readStoreResult(): StoreLoad {
  try {
    const text=localStorage.getItem(KEY);
    if(!text) return {store:emptyStore()};
    const store=decodeStore(text);
    return store ? {store} : {store:emptyStore(),issue:'damaged',raw:text};
  } catch { return {store:emptyStore(),issue:'unavailable'}; }
}
export function readStore(): Store { return readStoreResult().store; }
export function writeStore(store:Store):boolean {
  try {
    const old=localStorage.getItem(KEY);
    if(old && JSON.parse(old)?.version === 1 && !localStorage.getItem(KEY+'-backup')) localStorage.setItem(KEY+'-backup',old);
    localStorage.setItem(KEY,JSON.stringify(store)); return true;
  } catch { return false; }
}
export function clearDamagedStore():boolean {
  try { localStorage.removeItem(KEY); return true; } catch { return false; }
}
export function downloadRecovery(raw:string) {
  const url=URL.createObjectURL(new Blob([raw],{type:'application/json'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download='nowrecommend-recovery.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
