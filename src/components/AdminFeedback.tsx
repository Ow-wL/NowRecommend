import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import { ApiError } from '../api/client';
import { deleteFeedback, feedbackKinds, fetchFeedback, type FeedbackEntry } from '../api/feedback';

const KIND_LABEL = Object.fromEntries(feedbackKinds) as Record<FeedbackEntry['kind'], string>;

// What people sent with 의견 보내기, for an admin account (#/admin, under the error reports). Shown as plain text.
export function AdminFeedback({ token }: { token?: string }) {
  const [items, setItems] = useState<FeedbackEntry[]>([]), [more, setMore] = useState(false);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [news, setNews] = useState('');
  const [denied, setDenied] = useState(false);  // not an admin: the error reports above already say so
  const asked = useRef(0);
  const load = useCallback(async (before?: FeedbackEntry) => {
    if (!token) { setDenied(true); return; }
    const mine = ++asked.current;
    setBusy(true);
    try {
      const page = await fetchFeedback(token, before);
      if (mine !== asked.current) return;
      setItems(list => before ? [...list, ...page.feedback] : page.feedback); setMore(page.more); setError('');
    } catch (err) {
      if (mine !== asked.current) return;
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) setDenied(true); else setError('의견을 불러오지 못했어요.');
    } finally { if (mine === asked.current) setBusy(false); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  async function remove(item: FeedbackEntry) {
    if (!token) return;
    setBusy(true);
    try { await deleteFeedback(token, item.id); setItems(list => list.filter(i => i.id !== item.id)); setNews('의견을 지웠어요.'); }
    catch { setNews('의견을 지우지 못했어요. 다시 시도해주세요.'); }
    finally { setBusy(false); }
  }
  if (denied) return null;
  return <section className="flow-body neutral-scope admin-feedback" aria-labelledby="admin-feedback-title">
    <div className="report-toolbar">
      <h2 id="admin-feedback-title">받은 의견</h2>
      <button className="icon-button" aria-label="의견 새로고침" disabled={busy} onClick={() => void load()}><RefreshCw size={18} /></button>
    </div>
    <p className="sr-only" role="status">{news}</p>
    {error ? <div className="notice warning" role="alert"><div><strong>{error}</strong></div></div> : <>
      {!items.length && !busy && <p className="empty-small">받은 의견이 없어요.</p>}
      <ul className="report-list">{items.map(item => <li key={item.id} className="report-card">
        <div className="report-body">
          <p className="report-kind-label">{KIND_LABEL[item.kind]}</p>
          <p className="report-note">{item.message}</p>
          <small className="muted">{new Date(item.createdAt).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}{item.page && ` · ${item.page} 화면`}{item.appVersion && ` · ${item.appVersion}`}{item.contact && ` · 답장: ${item.contact}`}</small>
          <div className="report-actions"><button className="button secondary compact" disabled={busy} onClick={() => void remove(item)}><Trash2 size={15} />지우기</button></div>
        </div>
      </li>)}</ul>
      {more && <button className="button secondary" disabled={busy} onClick={() => void load(items[items.length - 1])}>더 보기</button>}
    </>}
  </section>;
}
