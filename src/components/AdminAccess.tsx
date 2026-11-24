import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { ApiError } from '../api/client';
import { fetchAccess, type AccessEntry } from '../api/stats';

// Who came in (2026-11-24, GET /api/admin/access): the address and time of a visit, sign-up, login or recommendation, kept
// 30 days for looking into abuse and failures (privacy policy: 접속 기록). Not linked to an account.
const EVENT_LABEL: Record<string, string> = { visit: '방문', signup: '가입', login: '로그인', 'recommend:food': '음식 추천', 'recommend:music': '음악 추천' };
const kst = (iso: string) => new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function AdminAccess({ token }: { token?: string }) {
  const [entries, setEntries] = useState<AccessEntry[]>([]), [more, setMore] = useState(false);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [filter, setFilter] = useState('');
  const asked = useRef(0);
  const load = useCallback(async (before?: number) => {
    if (!token) { setError('관리자 계정으로 로그인해야 볼 수 있어요.'); return; }
    const mine = ++asked.current;
    setBusy(true);
    try {
      const page = await fetchAccess(token, before);
      if (mine !== asked.current) return;
      setEntries(list => before ? [...list, ...page.entries] : page.entries); setMore(page.more); setError('');
    } catch (err) {
      if (mine === asked.current) setError(err instanceof ApiError && (err.status === 401 || err.status === 403) ? '관리자 계정으로 로그인해야 볼 수 있어요.' : '접속 기록을 불러오지 못했어요.');
    } finally { if (mine === asked.current) setBusy(false); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  const shown = useMemo(() => { const f = filter.trim(); return f ? entries.filter(e => e.address.includes(f)) : entries; }, [entries, filter]);
  return <section className="flow-body neutral-scope admin-access" aria-labelledby="admin-access-title">
    <div className="report-toolbar">
      <h2 id="admin-access-title">접속 기록</h2>
      <button className="icon-button" aria-label="접속 기록 새로고침" disabled={busy} onClick={() => void load()}><RefreshCw size={18} /></button>
    </div>
    <p className="muted small">방문(브라우저마다 하루 한 번), 가입, 로그인, 추천 요청이 들어온 IP와 시각이에요. 30일이 지나면 지워지고, 계정과 연결하지 않아요.</p>
    <label className="find-field access-filter"><span className="sr-only">IP로 찾기</span><input type="search" placeholder="IP로 찾기 (예: 203.0.113)" value={filter} onChange={e => setFilter(e.target.value)} /></label>
    {error ? <div className="notice warning" role="alert"><div><strong>{error}</strong></div></div> : <>
      {!shown.length && !busy && <p className="empty-small">{filter ? '이 IP의 기록이 불러온 범위에 없어요.' : '아직 접속 기록이 없어요.'}</p>}
      {shown.length > 0 && <div className="table-scroll"><table className="access-table">
        <thead><tr><th scope="col">시각 (한국)</th><th scope="col">IP</th><th scope="col">무엇</th></tr></thead>
        <tbody>{shown.map(e => <tr key={e.id}><td>{kst(e.at)}</td><td className="mono"><button className="text-button" onClick={() => setFilter(e.address)} aria-label={`${e.address} 기록만 보기`}>{e.address}</button></td><td>{EVENT_LABEL[e.event] || e.event}</td></tr>)}</tbody>
      </table></div>}
      {more && <button className="button secondary" disabled={busy} onClick={() => void load(entries[entries.length - 1]?.id)}>더 보기</button>}
    </>}
  </section>;
}
