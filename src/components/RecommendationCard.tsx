import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Ban, Check, ChevronRight, CircleDashed, Columns2, ExternalLink, Flag, Heart, Info, MapPin, MoreHorizontal, Pin, Play, RefreshCw, Search, ThumbsUp } from 'lucide-react';
import type { Item } from '../data';
import { checkText, NO_TASTE_REASON, type ConditionCheck } from '../domain';
import { mapSearch, mediaFor, mediaOf, overseasLink, songLink, youtubeSearch } from '../media';
import { useSongCheck, type SongStatus } from '../songCheck';
import { ItemArt } from './ItemArt';
import { PreviewButton } from './PreviewButton';

const SONG_NEWS = { checking: '곡 정보를 확인하고 있어요', found: 'Apple Music에서 곡을 찾았어요', missing: 'Apple Music 검색에서 일치하는 정보를 찾지 못했어요', failed: '지금은 확인할 수 없어요' };

// One clear action per card (DESIGN.md §3): music leads with listening, food with recording the choice; saving sits in
// the header and the request tools live behind "더보기". Links are labelled for what they are: a song page or a search.
export function RecommendationCard({ onReport, reported = false, onRefine, onSongStatus, item, saved, reasons, checks = [], familiar = false, onSave, onExclude, onSelect, onDetails, onPin, onReplace, onCompare, onLike, pinned=false, compared=false, compareDisabled=false, persisted = true, confidence, aiPick = false }: {
  /** Flags a wrong picture or wrong facts; absent without a server to send it to. */
  onReport?: () => void; reported?: boolean;
  /** Asks again within this dish: 치킨 → 뿌링클, 황금올리브, 허니콤보. Only for a name that covers several menus. */
  onRefine?: () => void;
  /** Reports the song check so the results can sum it up once. */
  onSongStatus?: (id: string, status: SongStatus) => void;
  item: Item; saved: boolean; reasons?: { tasteReason: string; contextReason: string; contrast?: string }; checks?: ConditionCheck[]; familiar?: boolean;
  onSave: () => void; onExclude: () => void; onSelect?: () => void; onDetails?: () => void; persisted?: boolean;
  onPin?:()=>void;onReplace?:()=>void;onCompare?:()=>void;onLike?:()=>void;pinned?:boolean;compared?:boolean;compareDisabled?:boolean;
  /** AI engine picks: the model's own confidence that the item exists as named (shown as a badge). */
  confidence?: 'high' | 'medium' | 'low'; aiPick?: boolean;
}) {
  // What the person should do about a pick we could not confirm: a song the store does not list, or a doubtful AI answer.
  const { status: songStatus, retry: retryCheck } = useSongCheck(item);
  // The retry button goes away while the check runs, so focus waits on the title and the outcome is announced.
  const title = useRef<HTMLHeadingElement>(null), [retried, setRetried] = useState(false);
  useEffect(() => { onSongStatus?.(item.id, songStatus); }, [item.id, songStatus]);  // eslint-disable-line react-hooks/exhaustive-deps
  const checkAgain = () => { setRetried(true); retryCheck(); title.current?.focus(); };
  const doubtful = item.category !== 'music' && !!confidence && confidence !== 'high';
  const saveLabel = saved ? persisted ? '저장됨' : '임시 저장' : '저장';
  const music = item.category === 'music';
  const saveButton = <button className={`icon-button save-button ${saved ? 'saved' : ''}`} aria-label={`${item.name} ${saved ? '저장 해제' : '저장'}`} aria-pressed={saved} title={saveLabel} onClick={onSave}><Heart size={20} fill={saved ? 'currentColor' : 'none'} /><span className="sr-only">{saveLabel}</span></button>;
  // The template sentence reads the same on every card, so the dish's own line says more about why this one.
  const templated = !!reasons && /^(이번 조건|고른 조건|등록 정보)/.test(reasons.contextReason);
  const lead = reasons && (templated && item.description && !music ? item.description : reasons.contextReason);
  const song = music ? songLink(item.id) : undefined, overseas = music ? overseasLink(item.id) : undefined;
  const media = mediaOf(item);
  const album = music ? mediaFor(item.id)?.album || mediaFor(item.id)?.link : undefined;
  const listen = music && (songStatus === 'checking' ? <span className="button listen-button checking"><span className="spinner" />곡 정보를 확인하고 있어요</span> : song
    ? <a className="button primary listen-button" href={song} target="_blank" rel="noopener noreferrer" aria-label={`${item.name} Apple Music에서 듣기 (새 탭)`}><Play size={15} fill="currentColor" />Apple Music에서 듣기</a>
    : <a className="button primary listen-button" href={youtubeSearch(item)} target="_blank" rel="noopener noreferrer" aria-label={`${item.name} YouTube에서 찾기 (새 탭)`}><Search size={16} />YouTube에서 찾기</a>);
  // Album artwork links to Apple Music (the artwork terms); it is never the only way to listen.
  const art = album ? <a className="item-art-link" href={song || album} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true"><ItemArt item={item} size="tile" /></a>
    : onDetails ? <button className="item-art-link" onClick={onDetails} aria-label={`${item.name} 사진 크게 보기`} tabIndex={-1}><ItemArt item={item} size={music ? 'tile' : 'card'} /></button>
    : <ItemArt item={item} size={music ? 'tile' : 'card'} />;
  return <article className={`item-card ${item.category}${pinned ? ' pinned' : ''}${reasons ? '' : ' plain'}${aiPick ? ' ai-pick' : ''}`}>
    <div className="art-frame">
      {art}
      {!music && saveButton}
      {music && <PreviewButton item={item} />}
    </div>
    <div className="item-body">
    <div className="item-head">
      <div className="item-title">
        <h3 ref={title} tabIndex={-1}>{item.name}</h3>
        <p className="item-subtitle">{item.subtitle}{music && item.releaseYear ? ` · ${item.releaseYear}` : ''}</p>
      </div>
      {music && saveButton}
      {(pinned || familiar || doubtful) && <span className="item-badges">{familiar && <span className="familiar-badge">내 취향</span>}{pinned && <span className="pin-badge"><Pin size={12} />고정</span>}{doubtful && <span className="check-badge">정보 확인 필요</span>}</span>}
    </div>
    {songStatus !== 'known' && <span className="sr-only" role="status">{retried && SONG_NEWS[songStatus]}</span>}
    {songStatus === 'missing' && <p className="song-note">Apple Music 검색에서 일치하는 정보를 찾지 못했어요 <button className="text-button" onClick={checkAgain}>다시 확인</button></p>}
    {songStatus === 'failed' && <p className="song-note">지금은 확인할 수 없어요 <button className="text-button" onClick={checkAgain}>다시 확인</button></p>}
    {media?.guestUnconfirmed && <p className="song-note">요청한 참여자는 확인하지 못했어요</p>}
    {media?.approx && <p className="song-note">이미지는 참고용이에요</p>}
    {/* One line of why on the card; the rest opens on demand so the picture stays the main thing. A missing tag reads
        "미등록" (the data does not say), not "해당 없음": the reason may still judge that it fits. */}
    {reasons ? <div className="reasons">
      <p className="lead">{(songStatus === 'missing' || songStatus === 'failed') && <b>AI가 제안한 이유</b>}{lead}</p>
      {reasons.contrast && !aiPick && <p className="contrast">{reasons.contrast}</p>}
      {(checks.length > 0 || reasons.tasteReason !== NO_TASTE_REASON || lead !== reasons.contextReason) && <details className="why"><summary>자세한 이유</summary><div className="why-body">
        {checks.length > 0 && <ul className="condition-checks" aria-label={`${item.name} 조건 확인`}>{checks.map(c => <li key={c.label} className={`${c.kind} ${c.state}`}>
          {c.state === 'met' ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : c.state === 'partial' ? <AlertTriangle size={13} aria-hidden="true" /> : <CircleDashed size={13} aria-hidden="true" />}
          <span aria-hidden="true">{c.state === 'untagged' ? `${c.label} 미등록` : c.label}</span><span className="sr-only">{checkText(c)}</span></li>)}</ul>}
        {lead !== reasons.contextReason && <p><b>이번 상황</b>{reasons.contextReason}</p>}
        {reasons.tasteReason !== NO_TASTE_REASON && <p><b>평소 취향</b>{reasons.tasteReason}</p>}
      </div></details>}
    </div> : <>
      <div className="mini-tags">{item.tags.slice(0, 3).map(t => <span key={t}>{t}</span>)}</div>
      <p className="item-description">{item.description}</p>
    </>}
    {onRefine && <button className="text-button refine-button" onClick={onRefine}>{item.name} 세부 메뉴 보기 <ChevronRight size={15} /></button>}
    <div className="card-actions">
      {music && listen}
      {onSelect && <button className={`button ${music ? 'secondary' : 'primary'} select-button`} aria-label={`${item.name} ${music ? '오늘의 곡으로 기록' : '오늘은 이걸로'}`} onClick={onSelect}>{music ? '오늘의 곡으로' : '오늘은 이걸로'}</button>}
      {!music && reasons && <a className="button secondary map-button" href={mapSearch(item)} target="_blank" rel="noopener noreferrer" aria-label={`${item.name} 네이버 지도에서 찾기 (새 탭)`}><MapPin size={17} />지도에서 찾기</a>}
      {reasons ? <MoreMenu label={`${item.name} 더보기`}>
        {onDetails && <button aria-label={`${item.name} 추천 이유 보기`} onClick={onDetails}><Info size={17} />추천 이유 보기</button>}
        {song && <a href={youtubeSearch(item)} target="_blank" rel="noopener noreferrer" aria-label={`${item.name} YouTube에서 찾기 (새 탭)`}><ExternalLink size={17} />YouTube에서 찾기</a>}
        {overseas && <a className="overseas-link" href={overseas} target="_blank" rel="noopener noreferrer" aria-label={`${item.name} Apple Music 해외 스토어에서 보기, 한국 계정 이용 가능 여부 미확인 (새 탭)`}><ExternalLink size={17} /><span>Apple Music 해외 스토어에서 보기<small>한국 계정 이용 가능 여부 미확인</small></span></a>}
        {onLike && <button aria-label={`${item.name} 내 취향에 추가`} onClick={onLike}><ThumbsUp size={17} />내 취향에 추가</button>}
        {onPin && <button aria-label={`${item.name} 이번 요청 고정`} aria-pressed={pinned} onClick={onPin}><Pin size={17} />{pinned ? '고정 해제' : '이번 요청 고정'}</button>}
        {onReplace && <button aria-label={`${item.name} 한 장 교체`} disabled={pinned} onClick={onReplace}><RefreshCw size={17} />다른 후보로 교체</button>}
        {onCompare && <button aria-label={`${item.name} 비교 항목`} aria-pressed={compared} disabled={compareDisabled} onClick={onCompare}><Columns2 size={17} />{compared ? '비교에서 빼기' : '비교에 담기'}</button>}
        {onReport && <button aria-label={`${item.name} 오류 신고`} disabled={reported} onClick={onReport}><Flag size={17} />{reported ? '신고했어요' : '오류 신고'}</button>}
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
    // Tabbing past the last item closes the list. No related target (a click on Safari) is left to the other handlers.
    const left = (e: FocusEvent) => { if (e.relatedTarget && !root.current?.contains(e.relatedTarget as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside); root.current?.addEventListener('keydown', key); root.current?.addEventListener('focusout', left);
    root.current?.querySelector<HTMLElement>('.more-menu :is(button:not(:disabled), a)')?.focus();
    const node = root.current;
    return () => { document.removeEventListener('pointerdown', outside); node?.removeEventListener('keydown', key); node?.removeEventListener('focusout', left); };
  }, [open]);
  return <div className="more" ref={root}>
    <button ref={toggle} className="button secondary more-toggle" aria-label={label} aria-expanded={open} onClick={() => setOpen(o => !o)}><MoreHorizontal size={20} /></button>
    {open && <div className={`more-menu${up ? ' up' : ''}`} onClick={e => { if ((e.target as HTMLElement).closest('button, a')) { setOpen(false); toggle.current?.focus(); } }}>{children}</div>}
  </div>;
}
