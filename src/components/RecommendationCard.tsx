import { ChevronRight, Columns2, ExternalLink, Heart, Info, Music2, Pin, RefreshCw } from 'lucide-react';
import type { Item } from '../data';

// One clear action (choose) on top; the request tools sit in a quiet row below it (DESIGN.md §6).
export function RecommendationCard({ item, saved, reasons, onSave, onExclude, onSelect, onDetails, onPin, onReplace, onCompare, pinned=false, compared=false, compareDisabled=false, persisted = true }: {
  item: Item; saved: boolean; reasons?: { tasteReason: string; contextReason: string };
  onSave: () => void; onExclude: () => void; onSelect?: () => void; onDetails?: () => void; persisted?: boolean;
  onPin?:()=>void;onReplace?:()=>void;onCompare?:()=>void;pinned?:boolean;compared?:boolean;compareDisabled?:boolean;
}) {
  const saveLabel = saved ? persisted ? '저장됨' : '임시 저장' : '저장';
  return <article className={`item-card ${item.category}${pinned ? ' pinned' : ''}`}>
    <div className="item-head">
      <div className="item-art" aria-hidden="true"><span>{item.category === 'food' ? item.emoji : <Music2 size={24} />}</span></div>
      <div className="item-title">
        <h3>{item.name}</h3>
        <p className="item-subtitle">{item.subtitle}{item.category === 'food' && <span> · 참고 가격</span>}</p>
      </div>
      {pinned && <span className="pin-badge"><Pin size={12} />고정</span>}
    </div>
    <div className="mini-tags">{item.tags.slice(0, 3).map(t => <span key={t}>{t}</span>)}</div>
    {reasons ? <div className="reasons"><p><b>평소 취향</b>{reasons.tasteReason}</p><p><b>이번 상황</b>{reasons.contextReason}</p></div> : <p className="item-description">{item.description}</p>}
    <div className="card-actions">
      {onSelect && <button className="button primary select-button" onClick={onSelect}>이걸로 선택</button>}
      <div className="card-tools">
        {onDetails && <button className="tool" aria-label={`${item.name} 상세 보기`} onClick={onDetails}><Info size={18} /><span>상세</span></button>}
        {onPin && <button className={`tool ${pinned ? 'on' : ''}`} aria-label={`${item.name} 이번 요청 고정`} aria-pressed={pinned} onClick={onPin}><Pin size={18} /><span>{pinned ? '고정됨' : '고정'}</span></button>}
        {onReplace && <button className="tool" aria-label={`${item.name} 한 장 교체`} disabled={pinned} onClick={onReplace}><RefreshCw size={18} /><span>교체</span></button>}
        {onCompare && <button className={`tool ${compared ? 'on' : ''}`} aria-label={`${item.name} 비교 항목`} aria-pressed={compared} disabled={compareDisabled} onClick={onCompare}><Columns2 size={18} /><span>{compared ? '비교 중' : '비교'}</span></button>}
        <button className={`tool save-button ${saved ? 'saved' : ''}`} aria-label={`${item.name} ${saved ? '저장 해제' : '저장'}`} aria-pressed={saved} onClick={onSave}><Heart size={18} fill={saved ? 'currentColor' : 'none'} /><span>{saveLabel}</span></button>
      </div>
      {item.category === 'music' && <a className="text-button youtube-link" href={`https://www.youtube.com/results?search_query=${encodeURIComponent(item.subtitle + ' ' + item.name)}`} target="_blank" rel="noopener noreferrer" aria-label={`${item.name} YouTube에서 검색 (새 탭)`}>YouTube에서 검색 <ExternalLink size={14} /></a>}
    </div>
    {reasons && <button className="feedback-button" onClick={onExclude}>추천에서 제외 <ChevronRight size={14} /></button>}
  </article>;
}
