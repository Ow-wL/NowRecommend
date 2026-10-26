import { unsupportedConditions, type HistoryEntry, type Recommendation } from '../domain';
import {ReviewForm} from './ReviewForm';
export function HistoryDetails({ entry, onSelect, onCancel, onReview,persisted=true }: { entry: HistoryEntry; onSelect: (result: Recommendation, roundId: string) => void; onCancel: () => void;onReview?:(rating:NonNullable<HistoryEntry['review']>['rating'],note:string)=>void;persisted?:boolean }) {
  return <div className="history-details">
    <p className="modal-description">당시 기록 · {entry.raw}</p>
    {unsupportedConditions(entry.raw, entry.category).some(u => u.kind === 'price') && <p className="small">당시 문장은 그대로 보여드려요. 가격 조건은 지원하지 않아 다시 추천할 때 적용하지 않아요.</p>}
    <div className="mini-tags">{entry.conditions.tags.map(t=><span key={t}>{t}</span>)}{entry.conditions.excluded.map(t=><span key={t} className="excluded-tag">{t} 제외</span>)}</div>
    {entry.legacy && <p>이전 버전 기록에는 추천 이유가 없어요. 보존된 결과 ID: {entry.resultIds.join(', ') || '없음'}</p>}
    {entry.selected && <section className="notice"><div><strong>최종 선택: {entry.selected.result.item.name}</strong><p>{entry.selected.result.tasteReason}</p><p>{entry.selected.result.contextReason}</p><button className="text-button" onClick={onCancel}>선택 취소</button></div></section>}
    {entry.selected && onReview && <ReviewForm key={entry.id} entry={entry} onSave={onReview} persisted={persisted}/>}
    {!!entry.trimmedRounds && <p className="small">오래된 상세 회차 {entry.trimmedRounds}개는 보관 상한에 따라 정리했어요. 최종 선택 요약은 유지돼요.</p>}
    {entry.rounds.map((round,index)=><section key={round.id} className="history-round"><h3>{index + 1 + (entry.trimmedRounds || 0)}회차 · {new Intl.DateTimeFormat('ko-KR',{month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',timeZone:'Asia/Seoul'}).format(new Date(round.date))}</h3><p>{round.raw || '직접 선택한 조건'}</p><div className="mini-tags">{round.conditions.tags.map(t=><span key={t}>{t}</span>)}{round.conditions.excluded.map(t=><span key={t}>{t} 제외</span>)}</div>{round.feedback.map((f,i)=><p key={i} className="small">{f.itemId} · {f.scope === 'long' ? '장기 비선호' : '이번 요청 제외'} · {f.action === 'restore' ? '복구' : '제외'}</p>)}{round.results.length === 0 && <p>당시 조건에 맞는 후보 없음</p>}{round.results.map(result=><div className="historical-result" key={result.item.id}><h4>{result.item.name}</h4><p className="small">{result.item.subtitle}</p><p>평소 취향: {result.tasteReason}</p><p>이번 상황: {result.contextReason}</p>{result.contrast && <p>당시 비교: {result.contrast}</p>}<button className="button secondary" disabled={entry.selected?.result.item.id === result.item.id && entry.selected.roundId === round.id} onClick={()=>onSelect(result,round.id)}>{entry.selected?.result.item.id === result.item.id && entry.selected.roundId === round.id ? '선택됨' : '이 항목으로 선택 변경'}</button></div>)}</section>)}
    <p className="small">현재 취향으로 다시 추천하면 별도의 새 요청을 시작해요.</p>
  </div>;
}
