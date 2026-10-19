import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Ban, Columns2, ExternalLink, Heart, Info, MoreHorizontal, Pin, RefreshCw } from 'lucide-react';
import type { Item } from '../data';

// One clear action (choose) per card; saving sits in the header and the request tools live behind "더보기" (DESIGN.md §3).
export function RecommendationCard({ item, saved, reasons, rank, onSave, onExclude, onSelect, onDetails, onPin, onReplace, onCompare, pinned=false, compared=false, compareDisabled=false, persisted = true }: {
  item: Item; saved: boolean; reasons?: { tasteReason: string; contextReason: string }; rank?: number;
  onSave: () => void; onExclude: () => void; onSelect?: () => void; onDetails?: () => void; persisted?: boolean;
  onPin?:()=>void;onReplace?:()=>void;onCompare?:()=>void;pinned?:boolean;compared?:boolean;compareDisabled?:boolean;
}) {
  const saveLabel = saved ? persisted ? '저장됨' : '임시 저장' : '저장';
  const youtube = `https://www.youtube.com/results?search_query=${encodeURIComponent(item.subtitle + ' ' + item.name)}`;
  return <article className={`item-card ${item.category}${pinned ? ' pinned' : ''}${reasons ? '' : ' plain'}`}>
    <div className="item-head">
      {rank !== undefined && <span className="item-rank" aria-hidden="true">{rank}</span>}
      <div className="item-title">
        <h3>{item.name}</h3>
        <p className="item-subtitle">{item.subtitle}{item.category === 'food' && <span> · 참고 가격</span>}</p>
      </div>
      {pinned && <span className="pin-badge"><Pin size={12} />고정</span>}
      <div className="item-quick">
        {item.category === 'music' && <a className="icon-button" href={youtube} target="_blank" rel="noopener noreferrer" aria-label={`${item.name} YouTube에서 검색 (새 탭)`} title="YouTube에서 검색"><ExternalLink size={18} /></a>}
        <button className={`icon-button save-button ${saved ? 'saved' : ''}`} aria-label={`${item.name} ${saved ? '저장 해제' : '저장'}`} aria-pressed={saved} title={saveLabel} onClick={onSave}><Heart size={19} fill={saved ? 'currentColor' : 'none'} /><span className="sr-only">{saveLabel}</span></button>
      </div>
    </div>
    {reasons ? <div className="reasons"><p><b>평소 취향</b>{reasons.tasteReason}</p><p><b>이번 상황</b>{reasons.contextReason}</p></div> : <>
      <div className="mini-tags">{item.tags.slice(0, 3).map(t => <span key={t}>{t}</span>)}</div>
      <p className="item-description">{item.description}</p>
    </>}
    <div className="card-actions">
      {onSelect && <button className="button primary select-button" onClick={onSelect}>이걸로 선택</button>}
      {reasons ? <MoreMenu label={`${item.name} 더보기`}>
        {onDetails && <button aria-label={`${item.name} 상세 보기`} onClick={onDetails}><Info size={17} />상세 보기</button>}
        {onPin && <button aria-label={`${item.name} 이번 요청 고정`} aria-pressed={pinned} onClick={onPin}><Pin size={17} />{pinned ? '고정 해제' : '이번 요청 고정'}</button>}
        {onReplace && <button aria-label={`${item.name} 한 장 교체`} disabled={pinned} onClick={onReplace}><RefreshCw size={17} />다른 후보로 교체</button>}
        {onCompare && <button aria-label={`${item.name} 비교 항목`} aria-pressed={compared} disabled={compareDisabled} onClick={onCompare}><Columns2 size={17} />{compared ? '비교에서 빼기' : '비교에 담기'}</button>}
        <button className="feedback-button" onClick={onExclude}><Ban size={17} />추천에서 제외</button>
      </MoreMenu> : onDetails && <button className="button secondary" aria-label={`${item.name} 상세 보기`} onClick={onDetails}>상세 보기</button>}
    </div>
  </article>;
}

// Disclosure menu: a toggle button and a short list of buttons. Escape or a click outside closes it; picking an item closes it too.
function MoreMenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false), [up, setUp] = useState(false);
  const root = useRef<HTMLDivElement>(null), toggle = useRef<HTMLButtonElement>(null);
  // Open upward when the list would run under the bottom bars (tab bar, comparison bar) or off the screen.
  useLayoutEffect(() => {
    if (!open) { setUp(false); return; }
    const box = root.current?.querySelector('.more-menu')?.getBoundingClientRect(), toggleBox = toggle.current?.getBoundingClientRect();
    if (box && toggleBox) setUp(box.bottom > window.innerHeight - 96 && toggleBox.top - box.height - 6 > 64);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); toggle.current?.focus(); } };
    document.addEventListener('pointerdown', outside); root.current?.addEventListener('keydown', key);
    root.current?.querySelector<HTMLButtonElement>('.more-menu button:not(:disabled)')?.focus();
    const node = root.current;
    return () => { document.removeEventListener('pointerdown', outside); node?.removeEventListener('keydown', key); };
  }, [open]);
  return <div className="more" ref={root}>
    <button ref={toggle} className="button secondary more-toggle" aria-label={label} aria-expanded={open} onClick={() => setOpen(o => !o)}><MoreHorizontal size={20} /></button>
    {open && <div className={`more-menu${up ? ' up' : ''}`} onClick={e => { if ((e.target as HTMLElement).closest('button')) { setOpen(false); toggle.current?.focus(); } }}>{children}</div>}
  </div>;
}
