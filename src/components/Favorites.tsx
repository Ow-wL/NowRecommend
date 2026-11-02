import { useState, type ReactNode } from 'react';
import { categoryLabel, type Category, type Item } from '../data';
import { useCatalog } from '../catalog';
import { resolveItem } from '../knownItems';
export function Favorites({ids,card,onRecommend,onStart}: {ids:string[];card:(i:Item)=>ReactNode;onRecommend:(c:Category,ids:string[])=>void;onStart:(c:Category)=>void}) {
  const [category,setCategory]=useState<'all'|Category>('all'),[query,setQuery]=useState(''),[tag,setTag]=useState('');
  const { items } = useCatalog();
  // AI picks saved from a server round are not in the catalog; the browser remembers them (knownItems).
  const saved=[...ids].reverse().map(id=>resolveItem(items,id)).filter((i):i is Item=>!!i);
  const tags=[...new Set(saved.filter(i=>category==='all' || i.category===category).flatMap(i=>i.tags))];
  const visible=saved.filter(i=>(category==='all'||i.category===category) && (!tag||i.tags.includes(tag)) && `${i.name} ${i.subtitle}`.toLowerCase().includes(query.toLowerCase()));
  return <><div className="page-heading"><h1>즐겨찾기 {saved.length > 0 && <span className="count">{saved.length}</span>}</h1></div><div className="filter-tabs" role="group" aria-label="분야 필터">{(['all','food','music'] as const).map(c=><button key={c} aria-pressed={c===category} className={c===category?'active':''} onClick={()=>{setCategory(c);setTag('');}}>{c==='all'?'전체':categoryLabel[c]}</button>)}</div><div className="favorite-filters"><label>즐겨찾기 검색<input value={query} placeholder="이름 또는 아티스트" onChange={e=>setQuery(e.target.value)}/></label><label>즐겨찾기 태그<select value={tag} onChange={e=>setTag(e.target.value)}><option value="">모든 태그</option>{tags.map(t=><option key={t}>{t}</option>)}</select></label><button className="text-button" onClick={()=>{setQuery('');setTag('');setCategory('all');}}>즐겨찾기 필터 초기화</button></div><p className="small">최근 저장순 · 표시된 후보 {visible.length}개</p><div className="card-actions">{(['food','music'] as Category[]).map(c=><button key={c} className="button secondary" disabled={!visible.some(i=>i.category===c)} onClick={()=>onRecommend(c,visible.filter(i=>i.category===c).map(i=>i.id))}>저장한 {categoryLabel[c]}에서 추천 ({visible.filter(i=>i.category===c).length}개)</button>)}</div><div className="collection-grid">{visible.map(i=>card(i))}</div>{!visible.length && <div className="empty-state"><h3>{ids.length?'검색·필터에 맞는 저장 항목이 없어요.':'아직 저장한 추천이 없어요.'}</h3><p>추천 카드의 하트를 누르면 여기에 모여요.</p><button className="button primary" onClick={()=>onStart(category==='music'?'music':'food')}>추천받으러 가기</button></div>}</>;
}
