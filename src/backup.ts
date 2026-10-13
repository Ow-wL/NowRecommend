import {items,options,exclusions,type Category} from './data';
import type {Store} from './domain';
import {decodeStore} from './storage';

export const MAX_BACKUP_BYTES=5_000_000;
export type BackupPreview={store:Store;date?:string};
const unique=(ids:string[])=>new Set(ids).size===ids.length;
export function importIssue(store:Store):string|null {
  const ids=new Map(items.map(i=>[i.id,i.category]));
  // Historical snapshots may refer to retired catalog IDs; validate against their frozen category.
  for(const h of store.history) for(const r of h.rounds) for(const v of r.results){if(ids.has(v.item.id) && ids.get(v.item.id)!==v.item.category)return '기록 항목의 분야가 일치하지 않아요.';ids.set(v.item.id,v.item.category);}
  for(const h of store.history) if(h.selected){const i=h.selected.result.item;if(ids.has(i.id)&&ids.get(i.id)!==i.category)return '선택 항목의 분야가 일치하지 않아요.';ids.set(i.id,i.category);}
  for(const c of ['food','music'] as Category[]){
    const p=store.profiles[c];
    if(![p.selected,p.disliked].every(a=>unique(a)&&a.every(id=>ids.get(id)===c)) || !unique(p.tags) || !p.tags.every(t=>options[c].includes(t)))return '취향의 항목 ID·태그·분야를 확인해주세요.';
  }
  if(!unique(store.favorites)||store.favorites.some(id=>!ids.has(id)))return '즐겨찾기 항목 ID가 올바르지 않아요.';
  if(!unique(store.history.map(h=>h.id)))return '기록 ID가 중복돼요.';
  const conditions=(v:any,c:Category)=>v.tags.length<=30 && v.excluded.length<=30 && unique(v.tags) && unique(v.excluded) && v.tags.every((t:string)=>[...options[c],...items.filter(i=>i.category===c).flatMap(i=>i.tags)].includes(t)) && v.excluded.every((t:string)=>exclusions[c].includes(t)) && (v.maxPrice===null || c==='food' && Number.isInteger(v.maxPrice));
  for(const h of store.history){
    if(!h.id || h.id.length>100 || h.raw.length>300 || !conditions(h.conditions,h.category) || !unique(h.resultIds)||h.resultIds.some(id=>ids.get(id)!==h.category)||!unique(h.rounds.map(r=>r.id)))return '기록 ID·분야·조건이 올바르지 않아요.';
    for(const r of h.rounds){
      if(!r.id || r.id.length>100 || r.raw.length>300 || !conditions(r.conditions,h.category)||r.results.length>5||!unique(r.results.map(v=>v.item.id))||r.results.some(v=>v.item.category!==h.category || !v.item.id || v.item.id.length>100)||r.excludedIds.some(id=>ids.get(id)!==h.category)||r.feedback.some(f=>ids.get(f.itemId)!==h.category) || r.candidateScope!==undefined && (r.candidateScope!=='favorites'||!Array.isArray(r.candidateIds)||!unique(r.candidateIds)||r.candidateIds.some(id=>ids.get(id)!==h.category)))return '회차 결과·제외·후보 범위 ID가 올바르지 않아요.';
    }
    if(h.selected && h.selected.result.item.category!==h.category)return '최종 선택 분야가 올바르지 않아요.';
  }
  return null;
}
export function createBackup(store:Store,date=new Date().toISOString()):string { return JSON.stringify({app:'nowrecommend',backupVersion:1,exportedAt:date,data:store},null,2); }
export function parseBackup(text:string):BackupPreview {
  if(new TextEncoder().encode(text).length>MAX_BACKUP_BYTES)throw new Error('백업은 5MB 이하만 가져올 수 있어요.');
  let value:any;try{value=JSON.parse(text);}catch{throw new Error('JSON 파일 형식이 올바르지 않아요.');}
  const envelope=value?.app!==undefined || value?.backupVersion!==undefined;
  if(envelope && (value.app!=='nowrecommend'||value.backupVersion!==1||typeof value.exportedAt!=='string'||!Number.isFinite(Date.parse(value.exportedAt))))throw new Error('백업 종류·버전·날짜가 올바르지 않아요.');
  const store=decodeStore(JSON.stringify(envelope?value.data:value));
  if(!store)throw new Error('저장 버전·자료형·개수 제한이 올바르지 않아요.');
  const issue=importIssue(store);if(issue)throw new Error(issue);
  return {store,date:envelope?value.exportedAt:undefined};
}
export function downloadBackup(store:Store) {const url=URL.createObjectURL(new Blob([createBackup(store)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`nowrecommend-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
