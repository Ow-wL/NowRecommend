import { cleanConditions, emptyStore, type Recommendation, type Store } from './domain';
import { normalizeItem } from './data';
import { validConditions, validRecommendation } from './sessionStorage';
import { validPreset } from './presets';
import {validAppearance} from './theme';
const KEY = 'nowrecommend-prototype-v1';
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
function validHistory(h: any, version: number): boolean {
  if (!h || typeof h.id !== 'string' || !date(h.date) || !['food','music'].includes(h.category) || typeof h.raw !== 'string' || !strings(h.resultIds) || !validConditions(h.conditions)) return false;
  if(version === 1) return true;
  return (h.legacy===undefined || typeof h.legacy==='boolean') && (h.trimmedRounds===undefined || Number.isInteger(h.trimmedRounds) && h.trimmedRounds>=0)
    && Array.isArray(h.rounds) && h.rounds.length <= 10 && h.rounds.every((r: any) => r && typeof r.id === 'string' && date(r.date) && typeof r.raw === 'string' && validConditions(r.conditions) && Array.isArray(r.results) && r.results.every(validRecommendation) && strings(r.excludedIds) && (r.catalogVersion===undefined || typeof r.catalogVersion==='string') && (r.candidateScope===undefined || r.candidateScope==='favorites' && strings(r.candidateIds)) && Array.isArray(r.feedback) && r.feedback.length<=100 && r.feedback.every((f:any) => f && typeof f.itemId === 'string' && ['session','long'].includes(f.scope) && ['exclude','restore'].includes(f.action) && date(f.date)))
    && (h.selected === undefined || validRecommendation(h.selected.result) && date(h.selected.date) && typeof h.selected.roundId === 'string')
    && (h.review === undefined || h.selected && (h.review.rating === undefined || ['good','neutral','poor'].includes(h.review.rating)) && typeof h.review.note==='string' && h.review.note.length<=200 && date(h.review.date) && h.review.itemId===h.selected.result.item.id && h.review.roundId===h.selected.roundId);
}
export function decodeStore(text: string): Store | null {
  try {
    if(text.length > 5000000) return null;
    const v = JSON.parse(text);
    if (![1,2].includes(v?.version) || typeof v.name !== 'string' || v.name.length > 100 || !['food','music'].every(c => ['selected','tags','disliked'].every(k => strings(v.profiles?.[c]?.[k]))) || !strings(v.favorites) || !Array.isArray(v.history) || v.history.length > 50 || !v.history.every((h:any) => validHistory(h,v.version))) return null;
    if (v.presets !== undefined && (!Array.isArray(v.presets) || v.presets.length > 40 || !v.presets.every(validPreset) || new Set(v.presets.map((p:any)=>p.id)).size !== v.presets.length || ['food','music'].some(c=>v.presets.filter((p:any)=>p.category===c).length > 20))) return null;
    if(v.appearance!==undefined && !validAppearance(v.appearance))return null;
    return withoutBudget(v.version === 2 ? v : { ...v, version:2, history:v.history.map((h:any)=>({id:h.id,date:h.date,category:h.category,raw:h.raw,conditions:h.conditions,resultIds:h.resultIds,rounds:[],legacy:true})) });
  } catch { return null; }
}
/** Price and budget were removed on 2026-10-27. Stored budgets (history, rounds, presets) and item prices are dropped
 * on every read, backups included, so they are neither shown nor applied again; the original sentences are kept. */
function withoutBudget(store: Store): Store {
  const result = (r: Recommendation): Recommendation => ({ ...r, item: normalizeItem(r.item) });
  return { ...store,
    history: store.history.map(h => ({ ...h, conditions: cleanConditions(h.conditions), rounds: h.rounds.map(r => ({ ...r, conditions: cleanConditions(r.conditions), results: r.results.map(result) })),
      ...(h.selected ? { selected: { ...h.selected, result: result(h.selected.result) } } : {}) })),
    ...(store.presets ? { presets: store.presets.map(p => ({ ...p, conditions: cleanConditions(p.conditions) })) } : {}) };
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
export function replaceStore(store:Store):boolean {
  try{const old=localStorage.getItem(KEY);if(old!==null)localStorage.setItem(KEY+'-before-import',old);localStorage.setItem(KEY,JSON.stringify(store));return true;}catch{return false;}
}
export function downloadRecovery(raw:string) {
  const url=URL.createObjectURL(new Blob([raw],{type:'application/json'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download='nowrecommend-recovery.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
