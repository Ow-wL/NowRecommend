import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { ApiError } from '../api/client';
import { fetchReports, kindLabel, updateReport, type Report, type ReportList, type ReportStatus } from '../api/reports';
import { ItemArt } from './ItemArt';

type Filter = ReportStatus | 'all';
const FILTERS: [Filter, string][] = [['open', '미처리'], ['resolved', '처리 완료'], ['dismissed', '반려'], ['all', '전체']];
const STATUS_LABEL: Record<ReportStatus, string> = { open: '미처리', resolved: '처리 완료', dismissed: '반려' };

// The admin's list of error reports (#/admin). The server decides who may read it; this page only says what it answered.
export function AdminReports({ token, onBack }: { token?: string; onBack: () => void }) {
  const [filter, setFilter] = useState<Filter>('open');
  const [data, setData] = useState<ReportList | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [news, setNews] = useState('');
  const asked = useRef(0), heading = useRef<HTMLHeadingElement>(null);
  const load = useCallback(async (next: Filter) => {
    if (!token) { setError('관리자 계정으로 로그인해야 볼 수 있어요.'); return; }
    const mine = ++asked.current;
    setBusy(true);
    try { const list = await fetchReports(token, next); if (mine === asked.current) { setData(list); setError(''); } }
    catch (err) { if (mine === asked.current) { setData(null); setError(err instanceof ApiError && (err.status === 401 || err.status === 403) ? '관리자 계정으로 로그인해야 볼 수 있어요.' : '신고 목록을 불러오지 못했어요.'); } }
    finally { if (mine === asked.current) setBusy(false); }
  }, [token]);
  useEffect(() => { void load(filter); }, [filter, load]);
  async function act(report: Report, update: { status?: ReportStatus; dropImage?: boolean }, done: string) {
    if (!token) return;
    setBusy(true);
    try { await updateReport(token, report.id, update); setNews(`${report.item.name}: ${done}`); await load(filter); heading.current?.focus(); }
    catch { setBusy(false); setNews(`${report.item.name}: 처리하지 못했어요. 다시 시도해주세요.`); }
  }
  return <>
    <div className="flow-head">
      <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> 내 취향으로</button>
      <h1 ref={heading} tabIndex={-1}>오류 신고 관리</h1>
      <p>사용자가 보낸 사진·정보 오류를 확인하고 처리해요.</p>
    </div>
    <div className="flow-body neutral-scope">
      {error ? <div className="notice warning" role="alert"><div><strong>{error}</strong></div></div> : <>
        <div className="report-toolbar">
          <div className="filter-tabs" role="group" aria-label="신고 상태">{FILTERS.map(([id, label]) => <button key={id} aria-pressed={filter === id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>{label}{id !== 'all' && data ? ` ${data.counts[id]}` : ''}</button>)}</div>
          <button className="icon-button" aria-label="새로고침" disabled={busy} onClick={() => void load(filter)}><RefreshCw size={18} /></button>
        </div>
        <p className="sr-only" role="status">{news}</p>
        {data && !data.reports.length && <p className="empty-small">{filter === 'open' ? '처리할 신고가 없어요.' : '해당하는 신고가 없어요.'}</p>}
        <ul className="report-list">{data?.reports.map(r => <li key={r.id} className="report-card">
          <ItemArt item={r.item} size="tile" />
          <div className="report-body">
            <div className="report-title"><b>{r.item.name}</b><small>{r.item.subtitle}</small></div>
            <p className="report-kind-label">{kindLabel(r.kind, r.item.category)}{r.status !== 'open' && <span className="report-status"> · {STATUS_LABEL[r.status]}</span>}</p>
            {r.note && <p className="report-note">{r.note}</p>}
            <small className="muted">{new Date(r.createdAt).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })} · {r.byMember ? '회원' : '손님'}</small>
            <div className="report-actions">
              {r.status === 'open' ? <>
                <button className="button primary compact" disabled={busy} onClick={() => void act(r, { status: 'resolved' }, '처리 완료했어요.')}>처리 완료</button>
                <button className="button secondary compact" disabled={busy} onClick={() => void act(r, { status: 'dismissed' }, '반려했어요.')}>반려</button>
              </> : <button className="button secondary compact" disabled={busy} onClick={() => void act(r, { status: 'open' }, '다시 열었어요.')}>다시 열기</button>}
              {r.canDropImage && <button className="button secondary compact" disabled={busy} onClick={() => void act(r, { dropImage: true, status: 'resolved' }, '참고 사진을 빼고 처리했어요.')}>참고 사진 빼기</button>}
            </div>
          </div>
        </li>)}</ul>
      </>}
    </div>
  </>;
}
