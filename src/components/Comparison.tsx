import { conditionChecks, type Conditions, type Recommendation } from '../domain';
// Side by side on what can be checked: traits, ingredients or artist, how each card meets the request, and the reasons.
export function Comparison({results,conditions,onChoose}: {results:Recommendation[];conditions?:Conditions;onChoose:(r:Recommendation)=>void}) {
  const food = results[0]?.item.category === 'food';
  const checks = (r:Recommendation) => conditions ? conditionChecks(r.item,conditions).map(c=>`${c.state==='met'?'✓':c.state==='partial'?'일부 확인':'–'} ${c.label}`).join(' · ') || '조건 없음' : '조건 없음';
  const rows:{name:string;value:(r:Recommendation)=>string}[]=[
    {name:'주요 특성',value:r=>r.item.tags.join(' · ') || '미등록'},
    {name:food?'등록 재료':'아티스트',value:r=>food?r.item.ingredients.join(' · ') || '미등록':r.item.subtitle || '미등록'},
    {name:'이번 조건',value:checks},
    {name:'평소 취향',value:r=>r.tasteReason},{name:'이번 상황',value:r=>r.contextReason},{name:'다른 후보와 비교',value:r=>r.contrast || '–'}];
  return <div className="comparison"><p className="small">최대 3개 · 고정·비교는 이번 요청에만 적용하며 장기 취향을 바꾸지 않아요.</p><table className="comparison-table"><caption>현재 추천 후보 비교</caption><thead><tr><th scope="col">비교 항목</th>{results.map(r=><th scope="col" key={r.item.id}>{r.item.name}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.name}><th scope="row">{row.name}</th>{results.map(r=><td key={r.item.id}>{row.value(r)}</td>)}</tr>)}<tr><th scope="row">최종 선택</th>{results.map(r=><td key={r.item.id}><button className="button primary" onClick={()=>onChoose(r)}>{r.item.name} 선택하고 기록</button></td>)}</tr></tbody></table><div className="comparison-cards">{results.map(r=><section className="panel" key={r.item.id}><h3>{r.item.name}</h3><dl>{rows.map(row=><div key={row.name}><dt>{row.name}</dt><dd>{row.value(r)}</dd></div>)}</dl><button className="button primary" onClick={()=>onChoose(r)}>{r.item.name} 선택하고 기록</button></section>)}</div></div>;
}
