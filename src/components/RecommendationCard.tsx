import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Ban, Check, CircleDashed, Columns2, ExternalLink, Heart, Info, MapPin, MoreHorizontal, Pin, Play, RefreshCw, Search, ThumbsUp } from 'lucide-react';
import type { Item } from '../data';
import { checkText, NO_TASTE_REASON, type ConditionCheck } from '../domain';
import { mapSearch, mediaFor, songLink, youtubeSearch } from '../media';
import { ItemArt } from './ItemArt';

// One clear action per card (DESIGN.md §3): music leads with listening, food with recording the choice; saving sits in
// the header and the request tools live behind "더보기". Links are labelled for what they are: a song page or a search.
export function RecommendationCard({ item, saved, reasons, rank, checks = [], familiar = false, onSave, onExclude, onSelect, onDetails, onPin, onReplace, onCompare, onLike, pinned=false, compared=false, compareDisabled=false, persisted = true, confidence, aiPick = false }: {
  item: Item; saved: boolean; reasons?: { tasteReason: string; contextReason: string; contrast?: string }; rank?: number; checks?: ConditionCheck[]; familiar?: boolean;
  onSave: () => void; onExclude: () => void; onSelect?: () => void; onDetails?: () => void; persisted?: boolean;
  onPin?:()=>void;onReplace?:()=>void;onCompare?:()=>void;onLike?:()=>void;pinned?:boolean;compared?:boolean;compareDisabled?:boolean;
  /** AI engine picks: the model's own confidence that the item exists as named (shown as a badge). */
  confidence?: 'high' | 'medium' | 'low'; aiPick?: boolean;
}) {
  // Nearly every AI pick is "high", so only the doubtful ones are worth a word on the card.
  const doubt = confidence && confidence !== 'high' ? confidence : undefined;
  const confidenceLabel = { medium: 'AI 확신 보통', low: 'AI 확신 낮음' } as const;
  const saveLabel = saved ? persisted ? '저장됨' : '임시 저장' : '저장';
  const music = item.category === 'music';
  const song = music ? songLink(item.id) : undefined;
  const album = music ? mediaFor(item.id)?.album || mediaFor(item.id)?.link : undefined;
  const listen = music && (song
    ? <a className="button primary listen-button" href={song} target="_blank" rel="noopener noreferrer" aria-label={`${item.name} Apple Music에서 듣기 (새 탭)`}><Play size={20} fill="currentColor" /><span className="listen-label">Apple Music에서 듣기</span></a>
    : <a className="button primary listen-button" href={youtubeSearch(item)} target="_blank" rel="noopener noreferrer" aria-label={`${item.name} YouTube에서 검색 (새 탭)`}><Search size={20} /><span className="listen-label">YouTube에서 검색</span></a>);
  // Album artwork links to Apple Music (the artwork terms); it is never the only way to listen.
  const art = album ? <a className="item-art-link" href={song || album} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true"><ItemArt item={item} size="tile" /></a>
    : onDetails ? <button className="item-art-link" onClick={onDetails} aria-label={`${item.name} 사진 크게 보기`} tabIndex={-1}><ItemArt item={item} size={music ? 'tile' : 'card'} /></button>
    : <ItemArt item={item} size={music ? 'tile' : 'card'} />;
  return <article className={`item-card ${item.category}${pinned ? ' pinned' : ''}${reasons ? '' : ' plain'}${aiPick ? ' ai-pick' : ''}`}>
    <div className="art-frame">
      {art}
      {rank !== undefined && <span className="item-rank" aria-hidden="true">{rank}</span>}
      <button className={`icon-button save-button ${saved ? 'saved' : ''}`} aria-label={`${item.name} ${saved ? '저장 해제' : '저장'}`} aria-pressed={saved} title={saveLabel} onClick={onSave}><Heart size={20} fill={saved ? 'currentColor' : 'none'} /><span className="sr-only">{saveLabel}</span></button>
      {listen}
    </div>
    <div className="item-body">
    <div className="item-head">
      <div className="item-title">
        <h3>{item.name}</h3>
        <p className="item-subtitle">{item.subtitle}</p>
      </div>
      {(pinned || familiar || doubt) && <span className="item-badges">{familiar && <span className="familiar-badge">내 취향</span>}{pinned && <span className="pin-badge"><Pin size={12} />고정</span>}{doubt && <span className={`confidence-badge ${doubt}`} title="AI가 밝힌, 이 항목이 실제로 있다는 확신">{confidenceLabel[doubt]}</span>}</span>}
    </div>
    {/* One line of why on the card; the rest opens on demand so the picture stays the main thing. A missing tag reads
        "미등록" (the data does not say), not "해당 없음": the reason may still judge that it fits. */}
    {reasons ? <div className="reasons">
      <p className="lead">{reasons.contextReason}</p>
      {(checks.length > 0 || reasons.tasteReason !== NO_TASTE_REASON || reasons.contrast) && <details className="why"><summary>추천 이유</summary><div className="why-body">
        {checks.length > 0 && <ul className="condition-checks" aria-label={`${item.name} 조건 확인`}>{checks.map(c => <li key={c.label} className={`${c.kind} ${c.state}`}>
          {c.state === 'met' ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : c.state === 'partial' ? <AlertTriangle size={13} aria-hidden="true" /> : <CircleDashed size={13} aria-hidden="true" />}
          <span aria-hidden="true">{c.state === 'untagged' ? `${c.label} 미등록` : c.label}</span><span className="sr-only">{checkText(c)}</span></li>)}</ul>}
        {reasons.tasteReason !== NO_TASTE_REASON && <p><b>평소 취향</b>{reasons.tasteReason}</p>}
        {reasons.contrast && <p className="contrast"><b>다른 후보와 비교</b>{reasons.contrast}</p>}
      </div></details>}
    </div> : <>
      <div className="mini-tags">{item.tags.slice(0, 3).map(t => <span key={t}>{t}</span>)}</div>
      <p className="item-description">{item.description}</p>
    </>}
    <div className="card-actions">
      {onSelect && <button className={`button ${music ? 'secondary' : 'primary'} select-button`} aria-label={`${item.name} 선택하고 기록`} onClick={onSelect}>선택하고 기록</button>}
      {!music && reasons && <a className="button secondary map-button" href={mapSearch(item)} target="_blank" rel="noopener noreferrer" aria-label={`${item.name} 네이버 지도에서 검색 (새 탭)`}><MapPin size={19} /><span className="map-label">지도 검색</span></a>}
      {reasons ? <MoreMenu label={`${item.name} 더보기`}>
        {onDetails && <button aria-label={`${item.name} 상세 보기`} onClick={onDetails}><Info size={17} />상세 보기</button>}
        {song && <a href={youtubeSearch(item)} target="_blank" rel="noopener noreferrer" aria-label={`${item.name} YouTube에서 검색 (새 탭)`}><ExternalLink size={17} />YouTube에서 검색</a>}
        {onLike && <button aria-label={`${item.name} 내 취향에 추가`} onClick={onLike}><ThumbsUp size={17} />내 취향에 추가</button>}
        {onPin && <button aria-label={`${item.name} 이번 요청 고정`} aria-pressed={pinned} onClick={onPin}><Pin size={17} />{pinned ? '고정 해제' : '이번 요청 고정'}</button>}
        {onReplace && <button aria-label={`${item.name} 한 장 교체`} disabled={pinned} onClick={onReplace}><RefreshCw size={17} />다른 후보로 교체</button>}
        {onCompare && <button aria-label={`${item.name} 비교 항목`} aria-pressed={compared} disabled={compareDisabled} onClick={onCompare}><Columns2 size={17} />{compared ? '비교에서 빼기' : '비교에 담기'}</button>}
        <button className="feedback-button" onClick={onExclude}><Ban size={17} />추천에서 제외</button>
      </MoreMenu> : onDetails && <button className="button secondary" aria-label={`${item.name} 상세 보기`} onClick={onDetails}>상세 보기</button>}
    </div>
    </div>
  </article>;
}

// Disclosure menu: a toggle button and a short list of buttons or links. Escape or a click outside closes it; picking an item closes it too.
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
    root.current?.querySelector<HTMLElement>('.more-menu :is(button:not(:disabled), a)')?.focus();
    const node = root.current;
    return () => { document.removeEventListener('pointerdown', outside); node?.removeEventListener('keydown', key); };
  }, [open]);
  return <div className="more" ref={root}>
    <button ref={toggle} className="button secondary more-toggle" aria-label={label} aria-expanded={open} onClick={() => setOpen(o => !o)}><MoreHorizontal size={20} /></button>
    {open && <div className={`more-menu${up ? ' up' : ''}`} onClick={e => { if ((e.target as HTMLElement).closest('button, a')) { setOpen(false); toggle.current?.focus(); } }}>{children}</div>}
  </div>;
}
