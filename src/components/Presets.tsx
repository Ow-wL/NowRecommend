import { useState } from 'react';
import { categoryLabel, type Category } from '../data';
import type { Conditions, Preset } from '../domain';
import { defaultPresets } from '../presets';
export function ConditionsSummary({conditions}: {conditions:Conditions}) {
  return <div className="mini-tags">{conditions.tags.map(t=><span key={t}>{t}</span>)}{conditions.excluded.map(t=><span key={t} className="excluded-tag">{t} 제외</span>)}{!conditions.tags.length && !conditions.excluded.length && <span>조건 없음 · 평소 취향 기준</span>}</div>;
}
export function Presets({category, presets, onPreview, onRename, onDelete}: {category:Category;presets:Preset[];onPreview:(p:Preset)=>void;onRename:(id:string,name:string)=>void;onDelete:(id:string)=>void}) {
  const [editing,setEditing]=useState(''),[name,setName]=useState('');
  return <section className="preset-section"><h2>{categoryLabel[category]} 빠른 조건</h2><div className="chips">{defaultPresets.filter(p=>p.category===category).map(p=><button key={p.id} className="chip" onClick={()=>onPreview(p)}>{p.name}</button>)}</div>{presets.some(p=>p.category===category) && <h3>내 조건 프리셋</h3>}{presets.filter(p=>p.category===category).map(p=><div className="preset-row" key={p.id}>{editing===p.id ? <form onSubmit={e=>{e.preventDefault();if(name.trim()){onRename(p.id,name.trim());setEditing('');}}}><label>새 프리셋 이름<input value={name} maxLength={30} required onChange={e=>setName(e.target.value)}/></label><button className="button secondary">이름 저장</button><button type="button" className="text-button" onClick={()=>setEditing('')}>취소</button></form> : <><button className="text-button" onClick={()=>onPreview(p)}>{p.name}</button><button className="text-button" aria-label={`${p.name} 이름 변경`} onClick={()=>{setEditing(p.id);setName(p.name);}}>이름 변경</button><button className="text-button danger" aria-label={`${p.name} 프리셋 삭제`} onClick={()=>onDelete(p.id)}>삭제</button></>}</div>)}</section>;
}
