import { ArrowRight, ChevronRight, Heart, Music2 } from 'lucide-react';
import type { Item } from '../data';

export function RecommendationCard({ item, saved, reasons, onSave, onExclude, onSelect }: {
  item: Item; saved: boolean; reasons?: { tasteReason: string; contextReason: string };
  onSave: () => void; onExclude: () => void; onSelect?: () => void;
}) {
  return <article className={`item-card ${item.category}`}>
    <div className="item-art" aria-hidden="true"><span>{item.category === 'food' ? item.emoji : <Music2 size={32} />}</span></div>
    <div className="item-body">
      <div className="item-title"><h3>{item.name}</h3></div>
      <p className="item-subtitle">{item.subtitle}{item.category === 'food' && <span> · 샘플 참고 가격</span>}</p>
      <div className="mini-tags">{item.tags.slice(0, 3).map(t => <span key={t}>{t}</span>)}</div>
      {reasons ? <div className="reasons"><p><b>평소 취향</b>{reasons.tasteReason}</p><p><b>이번 상황</b>{reasons.contextReason}</p></div> : <p className="item-description">{item.description}</p>}
      <div className="card-actions">
        {onSelect && <button className="button secondary" onClick={onSelect}>이걸로 선택</button>}
        <button className={`save-button button secondary ${saved ? 'saved' : ''}`} aria-label={`${item.name} ${saved ? '저장 해제' : '저장'}`} aria-pressed={saved} onClick={onSave}><Heart size={18} fill={saved ? 'currentColor' : 'none'} />{saved ? '저장됨' : '저장'}</button>
        {item.category === 'music' && <a className="text-button" href={`https://www.youtube.com/results?search_query=${encodeURIComponent(item.subtitle + ' ' + item.name)}`} target="_blank" rel="noopener noreferrer" aria-label={`${item.name} YouTube에서 검색 (새 탭)`}>YouTube에서 검색 <ArrowRight size={16} /></a>}
      </div>
      {reasons && <button className="feedback-button" onClick={onExclude}>추천에서 제외 <ChevronRight size={14} /></button>}
    </div>
  </article>;
}
