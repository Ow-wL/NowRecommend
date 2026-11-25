import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, RefreshCw, RotateCcw, StickyNote, Trash2 } from 'lucide-react';
import { ApiError } from '../api/client';
import { deleteFeedback, feedbackKinds, fetchFeedback, updateFeedback, type FeedbackEntry, type FeedbackKind, type FeedbackStatus } from '../api/feedback';

const KIND_LABEL = Object.fromEntries(feedbackKinds) as Record<FeedbackEntry['kind'], string>;
// The screen it was sent from, in the words of the app's own menus (screenName in api/feedback.ts keeps the route's first word).
const PAGE_LABEL: Record<string, string> = { home: '홈', recommend: '추천', onboard: '취향 등록', favorites: '즐겨찾기', history: '추천 기록', taste: '내 취향', login: '로그인', complete: '추천 완료', type: '취향 유형', admin: '관리', pair: '음식·음악 짝꿍', terms: '이용약관', privacy: '개인정보 처리방침' };
const STATUS: [FeedbackStatus | 'all', string][] = [['new', '새 의견'], ['done', '처리함'], ['all', '전체']];

// What people sent with 의견 보내기, for an admin account (the admin console's inbox). Shown as plain text. Since
// 2026-11-26 each can be marked done (and opened again) and carry a note only admins read.
export function AdminFeedback({ token }: { token?: string }) {
  const [items, setItems] = useState<FeedbackEntry[]>([]), [more, setMore] = useState(false), [counts, setCounts] = useState<Record<FeedbackStatus, number> | null>(null);
  const [status, setStatus] = useState<FeedbackStatus | 'all'>('new'), [kind, setKind] = useState<FeedbackKind | 'all'>('all');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [news, setNews] = useState('');
  const [denied, setDenied] = useState(false);  // not an admin: the error reports above already say so
  const [noting, setNoting] = useState<string | null>(null), [note, setNote] = useState('');
  const asked = useRef(0);
  const load = useCallback(async (before?: FeedbackEntry) => {
    if (!token) { setDenied(true); return; }
    const mine = ++asked.current;
    setBusy(true);
    try {
      const page = await fetchFeedback(token, before, { status, kind });
      if (mine !== asked.current) return;
      setItems(list => before ? [...list, ...page.feedback] : page.feedback); setMore(page.more); setCounts(page.counts || null); setError('');
    } catch (err) {
      if (mine !== asked.current) return;
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) setDenied(true); else setError('의견을 불러오지 못했어요.');
    } finally { if (mine === asked.current) setBusy(false); }
  }, [token, status, kind]);
  useEffect(() => { void load(); }, [load]);
  async function remove(item: FeedbackEntry) {
    if (!token || !window.confirm('이 의견을 지울까요? 되돌릴 수 없어요.')) return;
    setBusy(true);
    try { await deleteFeedback(token, item.id); setItems(list => list.filter(i => i.id !== item.id)); setNews('의견을 지웠어요.'); }
    catch { setNews('의견을 지우지 못했어요. 다시 시도해주세요.'); }
    finally { setBusy(false); }
  }
  async function change(item: FeedbackEntry, update: { status?: FeedbackStatus; note?: string }, done: string) {
    if (!token) return;
    setBusy(true);
    try {
      const next = await updateFeedback(token, item.id, update);
      setItems(list => status !== 'all' && next.status !== status ? list.filter(i => i.id !== item.id) : list.map(i => i.id === item.id ? next : i));
      if (update.status && counts) setCounts({ ...counts, [update.status]: counts[update.status] + 1, [update.status === 'done' ? 'new' : 'done']: Math.max(0, counts[update.status === 'done' ? 'new' : 'done'] - 1) });
      setNews(done); setNoting(null);
    } catch { setNews('처리하지 못했어요. 다시 시도해주세요.'); }
    finally { setBusy(false); }
  }
  if (denied) return null;
  return <section className="admin-feedback" aria-labelledby="admin-feedback-title">
    <div className="report-toolbar">
      <h2 id="admin-feedback-title">받은 의견</h2>
      <div className="filter-tabs" role="group" aria-label="의견 상태">{STATUS.map(([id, label]) => <button key={id} aria-pressed={status === id} className={status === id ? 'active' : ''} onClick={() => setStatus(id)}>{label}{id !== 'all' && counts ? ` ${counts[id]}` : ''}</button>)}</div>
      <label className="ac-select"><span className="sr-only">의견 종류</span><select value={kind} onChange={e => setKind(e.target.value as FeedbackKind | 'all')}><option value="all">모든 종류</option>{feedbackKinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <button className="icon-button" aria-label="의견 새로고침" disabled={busy} onClick={() => void load()}><RefreshCw size={18} /></button>
    </div>
    <p className="sr-only" role="status">{news}</p>
    {error ? <div className="notice warning" role="alert"><div><strong>{error}</strong></div></div> : <>
      {!items.length && !busy && <p className="empty-small">{status === 'new' ? '새로 처리할 의견이 없어요.' : '해당하는 의견이 없어요.'}</p>}
      <ul className="report-list">{items.map(item => <li key={item.id} className={`report-card text-only${item.status === 'done' ? ' settled' : ''}`}>
        <div className="report-body">
          <p className="report-kind-label">{KIND_LABEL[item.kind]}{item.status === 'done' && <span className="report-status"> · 처리함{item.handledAt ? ` (${new Date(item.handledAt).toLocaleDateString('ko-KR')})` : ''}</span>}</p>
          <p className="report-note">{item.message}</p>
          <small className="muted">{new Date(item.createdAt).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}{item.page && ` · ${PAGE_LABEL[item.page] || item.page} 화면`}{item.appVersion && ` · ${item.appVersion}`}{item.contact && ` · 답장: ${item.contact}`}</small>
          {item.note && noting !== item.id && <p className="ac-note"><StickyNote size={14} aria-hidden="true" /> {item.note}</p>}
          {noting === item.id && <form className="ac-note-form" onSubmit={e => { e.preventDefault(); void change(item, { note: note.trim() }, '메모를 저장했어요.'); }}>
            <label className="sr-only" htmlFor={`note-${item.id}`}>관리자 메모</label>
            <textarea id={`note-${item.id}`} value={note} maxLength={300} rows={2} placeholder="관리자만 보는 메모 (답장했는지, 고친 버전 등)" onChange={e => setNote(e.target.value)} />
            <div className="report-actions"><button className="button primary compact" disabled={busy}>메모 저장</button><button type="button" className="button secondary compact" onClick={() => setNoting(null)}>취소</button></div>
          </form>}
          {item.status !== undefined && noting !== item.id && <div className="report-actions">
            {item.status === 'new' ? <button className="button primary compact" disabled={busy} onClick={() => void change(item, { status: 'done' }, '처리함으로 옮겼어요.')}><Check size={15} />처리함</button>
              : <button className="button secondary compact" disabled={busy} onClick={() => void change(item, { status: 'new' }, '새 의견으로 되돌렸어요.')}><RotateCcw size={15} />다시 열기</button>}
            <button className="button secondary compact" disabled={busy} onClick={() => { setNoting(item.id); setNote(item.note || ''); }}><StickyNote size={15} />메모</button>
            <button className="button secondary compact" disabled={busy} onClick={() => void remove(item)}><Trash2 size={15} />지우기</button>
          </div>}
          {item.status === undefined && <div className="report-actions"><button className="button secondary compact" disabled={busy} onClick={() => void remove(item)}><Trash2 size={15} />지우기</button></div>}
        </div>
      </li>)}</ul>
      {more && <button className="button secondary" disabled={busy} onClick={() => void load(items[items.length - 1])}>더 보기</button>}
    </>}
  </section>;
}
