import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, Download, ExternalLink, Info, RefreshCw, SearchX, SlidersHorizontal, Sparkles, ThumbsDown, ThumbsUp, Trash2, X } from 'lucide-react';
import { exclusions, options, type Item } from '../data';
import { apiEnabled } from '../api/client';
import { fetchRecommendations } from '../api/recommend';
import { fetchParse } from '../api/parse';
import { fetchFreeSongs, fetchLabModels, songLabel } from '../api/lab';
import { applyParsed, changeText, conditionConflicts, createEditor, toggleCondition, type Profile, type Session } from '../domain';
import { newSession } from '../sessionStorage';
import { downloadLab, markKey, readLab, tally, upsertEntry, writeLab, type LabAnswer, type LabEntry, type LabMark, type LabSide, type LabSong, type LabVote } from '../lab';
import { ParseNotice } from './ParseNotice';

type ViewMode = 'both' | LabSide;
type TabState = { raw: string; session: Session; likedText: string; view: ViewMode; freeModel?: string; entry: LabEntry | null; poolIds: string[]; poolSeen: string[]; poolExcluded: string[]; freeAvoid: string[] };
const TAB_KEY = 'nowrecommend-lab-tab-v1';
const SIDE: Record<LabSide, { label: string; title: string; about: string }> = {
  pool: { label: 'A', title: '저장된 곡 목록에서', about: 'DB에 등록된 곡 중 상황·취향에 가까운 15곡을 찾고, AI가 그 안에서 5곡을 골라요.' },
  free: { label: 'B', title: 'AI 자유 추천', about: '목록 없이 AI가 아는 곡 중에서 바로 5곡을 골라요. 실제로 있는 곡인지는 검색으로 확인해주세요.' },
};
const confidenceLabel = { high: '확신 높음', medium: '확신 보통', low: '확신 낮음' } as const;
const markLabel: Record<LabMark, string> = { good: '좋아요', bad: '별로예요', missing: '없는 곡이에요' };

function readTabState(): TabState | null {
  try { const v = JSON.parse(sessionStorage.getItem(TAB_KEY) || 'null'); return v && typeof v.raw === 'string' && v.session?.category === 'music' ? v : null; } catch { return null; }
}
const freshSession = (): Session => ({ ...newSession('music'), editor: createEditor('', 'music') });
const splitLiked = (text: string) => [...new Set(text.split(/[,\n]/).map(s => s.trim()).filter(Boolean))].slice(0, 10).map(s => s.slice(0, 60));

export function MusicLab({ profile, items, onEditTaste, onHome }: { profile: Profile; items: Item[]; onEditTaste: () => void; onHome: () => void }) {
  const [initial] = useState(readTabState);
  const [session, setSession] = useState<Session>(initial?.session || freshSession());
  const [likedText, setLikedText] = useState(initial?.likedText || '');
  const [view, setView] = useState<ViewMode>(initial?.view || 'both');
  const [models, setModels] = useState<string[]>([]);
  const [freeModel, setFreeModel] = useState(initial?.freeModel || '');
  const [entry, setEntry] = useState<LabEntry | null>(initial?.entry || null);
  const [poolIds, setPoolIds] = useState<string[]>(initial?.poolIds || []);
  const [poolSeen, setPoolSeen] = useState<string[]>(initial?.poolSeen || []);
  const [poolExcluded, setPoolExcluded] = useState<string[]>(initial?.poolExcluded || []);
  const [freeAvoid, setFreeAvoid] = useState<string[]>(initial?.freeAvoid || []);
  const [busy, setBusy] = useState<Record<LabSide, boolean>>({ pool: false, free: false });
  const [parsing, setParsing] = useState(false);
  const [log, setLog] = useState<LabEntry[]>(readLab);
  const [logWarning, setLogWarning] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const token = useRef(0);
  const online = apiEnabled();
  const conflicts = conditionConflicts(session);
  const working = parsing || busy.pool || busy.free;
  const sides: LabSide[] = view === 'both' ? ['pool', 'free'] : [view];
  const liked = profile.selected.map(id => items.find(i => i.id === id)?.name).filter(Boolean);

  useEffect(() => {
    try { sessionStorage.setItem(TAB_KEY, JSON.stringify({ raw: session.raw, session, likedText, view, freeModel, entry, poolIds, poolSeen, poolExcluded, freeAvoid } satisfies TabState)); } catch { /* the lab still works without tab restore */ }
  }, [session, likedText, view, freeModel, entry, poolIds, poolSeen, poolExcluded, freeAvoid]);
  useEffect(() => () => { token.current++; }, []);
  useEffect(() => { if (online) fetchLabModels().then(list => { setModels(list); setFreeModel(m => list.includes(m) ? m : list[0] || ''); }).catch(() => setModels([])); }, [online]);

  function saveEntry(next: LabEntry) {
    setEntry(next);
    setLog(current => { const updated = upsertEntry(current, next); setLogWarning(!writeLab(updated)); return updated; });
  }
  // Both answers land asynchronously; each one merges into the latest copy of the round.
  const latest = useRef<LabEntry | null>(entry); latest.current = entry;
  function land(id: string, side: LabSide, answer: LabAnswer) {
    const current = latest.current;
    if (!current || current.id !== id) return;
    const next = { ...current, [side]: answer };
    latest.current = next;
    saveEntry(next);
  }

  function run(again: boolean) {
    if (!online || working || conflicts.length) return;
    const t = ++token.current;
    const liked = splitLiked(likedText);
    const seen = again ? [...new Set([...poolSeen, ...poolIds])] : [];
    const avoid = again ? [...new Set([...freeAvoid, ...(entry?.free?.songs || []).map(songLabel)])] : [];
    const excluded = again ? poolExcluded : [];
    if (!again) { setPoolExcluded([]); }
    setPoolSeen(seen); setFreeAvoid(avoid);
    const go = (base: Session) => {
      if (t !== token.current) return;
      setParsing(false); setSession(base);
      if (conditionConflicts(base).length) return;
      const round: LabEntry = { id: crypto.randomUUID(), date: new Date().toISOString(), raw: base.raw, conditions: structuredClone(base.conditions), likedText: liked,
        round: again && entry ? entry.round + 1 : 1, marks: {} };
      latest.current = round; saveEntry(round);
      setPoolIds([]);
      for (const side of sides) {
        setBusy(b => ({ ...b, [side]: true }));
        const started = performance.now();
        const ms = () => Math.round(performance.now() - started);
        const request: Promise<LabAnswer> = side === 'pool'
          ? fetchRecommendations({ ...base, seenIds: seen, excludedIds: excluded, pinnedIds: [], candidateScope: undefined }, profile).then(r => {
            if (t === token.current) setPoolIds(r.results.map(x => x.item.id));
            const songs = r.results.map(x => ({ title: x.item.name, artist: x.item.subtitle, tasteReason: x.tasteReason, contextReason: x.contextReason }));
            return r.meta.mode === 'rag' ? { songs, ms: ms(), status: 'ok' } : { songs, ms: ms(), status: 'fallback', detail: r.meta.ai === 'off' ? 'AI 꺼짐' : 'AI 응답 없음' };
          })
          : fetchFreeSongs({ raw: base.raw, conditions: base.conditions, profile, likedText: liked, avoid, model: freeModel || undefined }).then(r => {
            const model = r.meta.model || undefined;
            return r.meta.ai === 'used' ? { songs: r.results, ms: ms(), status: 'ok', detail: r.meta.issues || undefined, model } : { songs: [], ms: ms(), status: 'failed', detail: r.meta.ai === 'off' ? 'AI 꺼짐' : r.meta.issues || 'AI 응답 없음', model };
          });
        request.catch(error => ({ songs: [], ms: ms(), status: 'failed' as const, detail: error instanceof Error ? error.message : '서버 오류' }))
          .then(answer => { if (t === token.current) land(round.id, side, answer); })
          .finally(() => { if (t === token.current) setBusy(b => ({ ...b, [side]: false })); });
      }
    };
    // Same rule as the main flow: ask /api/parse once per new sentence, then use the merged conditions for both sides.
    const raw = session.raw, parsed = changeText(session, raw);
    if (!raw.trim() || (parsed.editor?.ai?.raw === raw && parsed.editor.ai.source !== 'local')) { go(parsed); return; }
    setParsing(true); setSession(parsed);
    fetchParse('music', raw)
      .then(r => go(applyParsed(parsed, raw, r.conditions, { raw, source: r.source, unparsed: r.unparsed })))
      .catch(() => go(applyParsed(parsed, raw, null, { raw, source: 'local', unparsed: [] })));
  }

  function mark(side: LabSide, song: LabSong, value: LabMark) {
    if (!entry) return;
    const key = markKey(side, song), marks = { ...entry.marks };
    if (marks[key] === value) delete marks[key]; else marks[key] = value;
    saveEntry({ ...entry, marks });
    // "별로" also keeps the song out of the next round of that side.
    const index = entry[side]?.songs.indexOf(song) ?? -1;
    if (side === 'pool' && poolIds[index]) setPoolExcluded(ids => marks[key] === 'bad' ? [...new Set([...ids, poolIds[index]])] : ids.filter(id => id !== poolIds[index]));
    if (side === 'free') setFreeAvoid(list => marks[key] === 'bad' || marks[key] === 'missing' ? [...new Set([...list, songLabel(song)])] : list.filter(l => l !== songLabel(song)));
  }
  const vote = (value: LabVote) => entry && saveEntry({ ...entry, vote: entry.vote === value ? undefined : value });
  function reset() { token.current++; setBusy({ pool: false, free: false }); setParsing(false); setSession(freshSession()); setEntry(null); setPoolIds([]); setPoolSeen([]); setPoolExcluded([]); setFreeAvoid([]); }

  const chips = (values: string[], selected: string[], onClick: (v: string) => void, kind = '') => <div className="chips">{values.map(v => <button key={v} className={`chip ${kind} ${selected.includes(v) ? 'selected' : ''}`} aria-pressed={selected.includes(v)} onClick={() => onClick(v)}>{selected.includes(v) && <Check size={13} />}{v}</button>)}</div>;
  const stats = tally(log);
  const songCard = (side: LabSide, song: LabSong, index: number) => {
    const key = markKey(side, song), current = entry?.marks[key];
    const youtube = `https://www.youtube.com/results?search_query=${encodeURIComponent(song.artist + ' ' + song.title)}`;
    return <article className="item-card lab-song" key={key}>
      <div className="item-head">
        <span className="item-rank" aria-hidden="true">{index + 1}</span>
        <div className="item-title"><h3>{song.title}</h3><p className="item-subtitle">{song.artist}</p></div>
        {song.confidence && <span className={`lab-confidence ${song.confidence}`}>{confidenceLabel[song.confidence]}</span>}
        <a className="icon-button" href={youtube} target="_blank" rel="noopener noreferrer" aria-label={`${song.title} YouTube에서 검색 (새 탭)`} title="YouTube에서 검색"><ExternalLink size={18} /></a>
      </div>
      <div className="reasons"><p><b>평소 취향</b>{song.tasteReason}</p><p><b>이번 상황</b>{song.contextReason}</p></div>
      <div className="lab-marks" role="group" aria-label={`${song.title} 평가`}>
        {(['good', 'bad', ...(side === 'free' ? ['missing' as const] : [])] as LabMark[]).map(m => <button key={m} className={`lab-mark ${m}`} aria-pressed={current === m} onClick={() => mark(side, song, m)}>
          {m === 'good' ? <ThumbsUp size={15} /> : m === 'bad' ? <ThumbsDown size={15} /> : <SearchX size={15} />}{markLabel[m]}</button>)}
      </div>
    </article>;
  };
  const column = (side: LabSide) => {
    const answer = entry?.[side];
    return <section className="lab-column" key={side} aria-labelledby={`lab-${side}`} aria-busy={busy[side]}>
      <header className="lab-column-head">
        <span className={`lab-side ${side}`}>{SIDE[side].label}</span>
        <div><h2 id={`lab-${side}`}>{SIDE[side].title}</h2><p>{SIDE[side].about}</p></div>
      </header>
      {busy[side] ? <div className="lab-loading" role="status"><span className="spinner" />추천을 고르는 중</div>
        : !answer ? <p className="lab-empty">{entry ? '이 방식은 이번 요청에서 실행하지 않았어요.' : '상황을 적고 추천받기를 눌러주세요.'}</p>
        : <>
          <div className="lab-meta">{answer.model && <span>{answer.model}</span>}<span>{answer.ms.toLocaleString()}ms</span><span>{answer.songs.length}곡</span>{answer.status === 'ok' && <span>AI 선택</span>}{answer.detail && answer.status === 'ok' && <span title="서버가 걸러낸 항목">정리: {answer.detail}</span>}</div>
          {answer.status === 'fallback' && <div className="notice warning" role="status"><Info size={18} /><div><strong>AI가 답하지 않아 유사도 순서로 보여드려요.</strong><p>{answer.detail}. 한도 초과나 응답 지연일 수 있어요.</p></div></div>}
          {answer.status === 'failed' && <div className="error-box" role="alert"><strong>AI가 곡을 추천하지 못했어요.</strong><p>{answer.detail}. 이 방식은 대체 결과가 없어요.</p></div>}
          {side === 'free' && answer.songs.length > 0 && <p className="lab-caution"><Info size={14} />AI가 직접 고른 곡이에요. 실제로 있는 곡인지 검색으로 확인해주세요.</p>}
          <div className="lab-songs">{answer.songs.map((s, i) => songCard(side, s, i))}</div>
        </>}
    </section>;
  };

  return <>
    <div className="flow-head">
      <button className="back-link" onClick={onHome}><ArrowLeft size={16} /> 홈으로</button>
      <span className="eyebrow">음악 AI 실험</span>
      <h1>두 가지 AI 추천을 비교해보세요.</h1>
      <p>같은 상황과 취향으로 A(저장된 곡 목록)와 B(AI 자유 추천)를 나란히 받아요. 실험 결과는 추천 기록과 취향에 반영하지 않아요.</p>
      <div className="taste-strip">
        <span className="taste-strip-label">평소의 나</span>
        <span className="taste-strip-items">{[...liked, ...profile.tags].join(' · ') || '등록된 음악 취향 없음'}</span>
        <button className="text-button" onClick={onEditTaste}>취향 수정</button>
      </div>
    </div>
    {!online && <div className="notice warning" role="status"><Info size={18} /><div><strong>추천 서버가 연결된 사이트에서만 쓸 수 있어요.</strong><p>두 방식 모두 서버의 AI를 사용해요. 지금은 이 브라우저만으로 동작하는 모드예요.</p></div></div>}
    {online && profile.selected.length < 5 && <div className="notice" role="status"><Info size={18} /><div><strong>음악 취향을 5곡 이상 등록하면 더 공정하게 비교할 수 있어요.</strong><p>등록한 취향은 두 방식에 똑같이 보내요.</p><button className="text-button" onClick={onEditTaste}>음악 취향 등록하기</button></div></div>}

    <div className="flow-body composer lab-composer">
      <section className="panel compose-panel">
        <label className="field-title" htmlFor="lab-situation">지금의 상황</label>
        <textarea id="lab-situation" maxLength={300} value={session.raw} onChange={e => setSession(s => changeText(s, e.target.value))} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(false); } }} placeholder="예: 비 오는 밤 혼자 걸으면서 들을 노래" />
        <div className="textarea-caption">
          <div className="example-row">{['과제할 때 듣는 연주곡', '신나게 달리기', '비 오는 밤 혼자 듣기 좋은 노래'].map(text => <button key={text} onClick={() => setSession(s => changeText(s, text))}>{text}</button>)}</div>
          <span>{session.raw.length}/300</span>
        </div>
        <div className="condition-summary">
          <h3>이번 요청 조건</h3>
          {session.conditions.tags.length + session.conditions.excluded.length ? <div className="chips">
            {session.conditions.tags.map(t => <button className="chip selected" key={t} onClick={() => setSession(s => toggleCondition(s, t))} aria-label={`${t} 조건 삭제`}>{t}<X size={13} /></button>)}
            {session.conditions.excluded.map(t => <button className="chip exclude selected" key={t} onClick={() => setSession(s => toggleCondition(s, t, true))} aria-label={`${t} 제외 조건 삭제`}>{t} 제외<X size={13} /></button>)}
          </div> : <p className="muted small">문장을 적거나 아래에서 골라주세요. 비워두면 평소 취향으로 추천해요.</p>}
          <ParseNotice ai={session.editor?.ai} raw={session.raw} />
        </div>
        <label className="field-title lab-liked-label" htmlFor="lab-liked">목록에 없는 좋아하는 곡·아티스트 <small>B에만 적용 · 쉼표로 구분, 최대 10개</small></label>
        <input id="lab-liked" className="lab-liked" maxLength={400} value={likedText} onChange={e => setLikedText(e.target.value)} placeholder="예: 검정치마, 잔나비 - 주저하는 연인들을 위해" />
      </section>
      <details className="panel more-conditions">
        <summary><SlidersHorizontal size={16} /> 조건 직접 고르기<ChevronDown size={16} className="chevron" /></summary>
        {[{ label: '활동', values: ['과제', '휴식', '산책', '운동'] }, { label: '분위기', values: options.music.filter(t => !['과제', '휴식', '산책', '운동', '보컬', '연주곡'].includes(t)) }, { label: '보컬', values: ['보컬', '연주곡'] }]
          .map(group => <div className="chip-group" key={group.label}><h3>{group.label}</h3>{chips(group.values, session.conditions.tags, v => setSession(s => toggleCondition(s, v)))}</div>)}
        <div className="chip-group"><h3>반드시 제외 <small>두 방식 모두에 보내요</small></h3>{chips(exclusions.music, session.conditions.excluded, v => setSession(s => toggleCondition(s, v, true)), 'exclude')}</div>
      </details>
      {conflicts.length > 0 && <div className="error-box" role="alert">함께 적용할 수 없는 조건이 있어요: {conflicts.join(', ')}. 조건을 해제한 뒤 진행해주세요.</div>}
      <div className="lab-actions">
        <div className="filter-tabs" role="group" aria-label="비교 방식">{(['both', 'pool', 'free'] as const).map(v => <button key={v} aria-pressed={view === v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>{v === 'both' ? '둘 다 나란히' : `${SIDE[v].label}만`}</button>)}</div>
        {models.length > 1 && view !== 'pool' && <label className="lab-model">B 모델<select value={freeModel} onChange={e => setFreeModel(e.target.value)}>{models.map(m => <option key={m} value={m}>{m}</option>)}</select></label>}
        <button className="button primary" disabled={!online || working || conflicts.length > 0} onClick={() => run(false)}>{working ? <span className="spinner" /> : <Sparkles size={16} />}{parsing ? '조건을 해석하는 중' : working ? '추천을 고르는 중' : '추천받기'}</button>
      </div>
    </div>

    {entry && <>
      <div className="section-heading result-heading lab-heading">
        <h2>{entry.raw || '직접 고른 조건'} <span className="count">{entry.round}회차</span></h2>
        <div className="mini-tags">{entry.conditions.tags.map(t => <span key={t}>{t}</span>)}{entry.conditions.excluded.map(t => <span className="excluded-tag" key={t}>{t} 제외</span>)}</div>
      </div>
      <div className={`lab-grid ${sides.length === 1 ? 'single' : ''}`}>{sides.map(column)}</div>
      {sides.length === 2 && (entry.pool || entry.free) && !working && <section className="panel lab-vote">
        <h2>이번 결과는 어느 쪽이 나았나요?</h2>
        <div className="lab-vote-buttons" role="group" aria-label="비교 평가">{([['pool', 'A가 나아요'], ['same', '비슷해요'], ['free', 'B가 나아요']] as const).map(([v, label]) => <button key={v} className={`button ${entry.vote === v ? 'primary' : 'secondary'}`} aria-pressed={entry.vote === v} onClick={() => vote(v)}>{label}</button>)}</div>
        <label className="field-title" htmlFor="lab-note">메모 <small>선택 사항</small></label>
        <textarea id="lab-note" className="lab-note" maxLength={200} value={entry.note || ''} onChange={e => saveEntry({ ...entry, note: e.target.value })} placeholder="예: B가 더 다양했지만 한 곡은 검색해도 안 나왔어요" />
      </section>}
      <div className="reroll-panel">
        <p>이미 본 곡과 ‘별로예요’·‘없는 곡이에요’로 표시한 곡은 빼고 다시 추천해요.</p>
        <div className="lab-reroll-actions"><button className="text-button" onClick={reset}>새 요청</button><button className="button secondary" disabled={working} onClick={() => run(true)}>{working ? <span className="spinner" /> : <RefreshCw size={16} />}다른 추천 보기</button></div>
      </div>
    </>}

    <details className="panel lab-log">
      <summary>실험 기록 <span className="count">{stats.rounds}</span><ChevronDown size={16} className="chevron" /></summary>
      {logWarning && <p className="danger small">기록을 브라우저에 저장하지 못했어요. 새로고침하면 사라질 수 있어요.</p>}
      <div className="lab-stats">
        <div><b>비교 평가</b><p>A가 나아요 {stats.votes.pool} · 비슷해요 {stats.votes.same} · B가 나아요 {stats.votes.free}</p></div>
        {(['pool', 'free'] as const).map(side => { const s = stats.sides[side]; return <div key={side}><b>{SIDE[side].label} {SIDE[side].title}</b>
          <p>응답 {s.answered}회 · 실패 {s.failed}회 · 평균 {s.avgMs === null ? '-' : `${s.avgMs.toLocaleString()}ms`}</p>
          <p>곡 {s.songs}개 중 좋아요 {s.good} · 별로예요 {s.bad}{side === 'free' ? ` · 없는 곡 ${s.missing}` : ''}</p></div>; })}
      </div>
      <p className="small muted">기록은 이 브라우저에만 저장돼요(최근 200회).</p>
      <div className="lab-log-actions">
        <button className="button secondary" disabled={!log.length} onClick={() => downloadLab(log)}><Download size={16} />JSON 내려받기</button>
        {confirmClear ? <><button className="text-button danger" onClick={() => { setLog([]); setLogWarning(!writeLab([])); setConfirmClear(false); }}><Trash2 size={15} />정말 지우기</button><button className="text-button" onClick={() => setConfirmClear(false)}>취소</button></>
          : <button className="text-button danger" disabled={!log.length} onClick={() => setConfirmClear(true)}><Trash2 size={15} />기록 지우기</button>}
      </div>
    </details>
  </>;
}
