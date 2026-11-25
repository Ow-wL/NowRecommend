import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { RefreshCw } from 'lucide-react';
import { ApiError } from '../api/client';
import { fetchAddress, type AddressHistory } from '../api/admin';
import { fetchAccess, type AccessEntry } from '../api/stats';
import { Drawer, Facts, kst as kstShort } from './admin/common';

// Who came in (2026-11-24, GET /api/admin/access): the address and time of a visit, sign-up, login or recommendation, kept
// 30 days for looking into abuse and failures (privacy policy: 접속 기록). Not linked to an account. Since 2026-11-26
// narrowed on the server by address, event and day, and one address opens its 30 days (the look is recorded).
const EVENT_LABEL: Record<string, string> = { visit: '방문', signup: '가입', login: '로그인', 'recommend:food': '음식 추천', 'recommend:music': '음악 추천' };
const kst = (iso: string) => new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
type Filter = { address: string; event: string; day: string };

export function AdminAccess({ token }: { token?: string }) {
  const [entries, setEntries] = useState<AccessEntry[]>([]), [more, setMore] = useState(false);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Filter>({ address: '', event: '', day: '' }), [filter, setFilter] = useState<Filter>({ address: '', event: '', day: '' });
  const [open, setOpen] = useState<string | null>(null);
  const asked = useRef(0);
  const load = useCallback(async (before?: number) => {
    if (!token) { setError('관리자 계정으로 로그인해야 볼 수 있어요.'); return; }
    const mine = ++asked.current;
    setBusy(true);
    try {
      const page = await fetchAccess(token, before, { filter: { address: filter.address.trim(), event: filter.event, day: filter.day } });
      if (mine !== asked.current) return;
      setEntries(list => before ? [...list, ...page.entries] : page.entries); setMore(page.more); setError('');
    } catch (err) {
      if (mine === asked.current) setError(err instanceof ApiError && (err.status === 401 || err.status === 403) ? '관리자 계정으로 로그인해야 볼 수 있어요.' : '접속 기록을 불러오지 못했어요.');
    } finally { if (mine === asked.current) setBusy(false); }
  }, [token, filter]);
  useEffect(() => { void load(); }, [load]);
  const apply = (e: FormEvent) => { e.preventDefault(); setFilter(draft); };
  const narrowed = !!(filter.address || filter.event || filter.day);
  return <section className="admin-access" aria-labelledby="admin-access-title">
    <div className="report-toolbar">
      <h2 id="admin-access-title">접속 기록</h2>
      <button className="icon-button" aria-label="접속 기록 새로고침" disabled={busy} onClick={() => void load()}><RefreshCw size={18} /></button>
    </div>
    <p className="muted small">방문(브라우저마다 하루 한 번), 가입, 로그인, 추천 요청이 들어온 IP와 시각이에요. 30일이 지나면 지워지고, 계정과 연결하지 않아요. IP는 여러 사람이 함께 쓰는 네트워크일 수 있어요.</p>
    <form className="ac-filters" onSubmit={apply}>
      <label className="ac-field"><span>IP (앞부분)</span><input type="search" placeholder="예: 203.0.113" value={draft.address} onChange={e => setDraft({ ...draft, address: e.target.value })} /></label>
      <label className="ac-field"><span>무엇</span><select value={draft.event} onChange={e => setDraft({ ...draft, event: e.target.value })}><option value="">전체</option>{Object.entries(EVENT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label className="ac-field"><span>날짜</span><input type="date" value={draft.day} onChange={e => setDraft({ ...draft, day: e.target.value })} /></label>
      <button className="button primary compact" disabled={busy}>거르기</button>
      {narrowed && <button type="button" className="button secondary compact" onClick={() => { const none = { address: '', event: '', day: '' }; setDraft(none); setFilter(none); }}>모두 보기</button>}
    </form>
    {error ? <div className="notice warning" role="alert"><div><strong>{error}</strong></div></div> : <>
      {!entries.length && !busy && <p className="empty-small">{narrowed ? '이 조건의 기록이 없어요.' : '아직 접속 기록이 없어요.'}</p>}
      {entries.length > 0 && <div className="table-scroll"><table className="access-table ac-table">
        <thead><tr><th scope="col">시각 (한국)</th><th scope="col">IP</th><th scope="col">무엇</th></tr></thead>
        <tbody>{entries.map(e => <tr key={e.id}><td>{kst(e.at)}</td><td className="mono"><button className="text-button" onClick={() => setOpen(e.address)} aria-label={`${e.address}의 30일 기록 보기`}>{e.address}</button></td><td>{EVENT_LABEL[e.event] || e.event}</td></tr>)}</tbody>
      </table></div>}
      {more && <button className="button secondary" disabled={busy} onClick={() => void load(entries[entries.length - 1]?.id)}>더 보기</button>}
    </>}
    {open && token && <AddressSheet token={token} address={open} onClose={() => setOpen(null)} onOnly={() => { const only = { address: open, event: '', day: '' }; setDraft(only); setFilter(only); setOpen(null); }} />}
  </section>;
}

function AddressSheet({ token, address, onClose, onOnly }: { token: string; address: string; onClose: () => void; onOnly: () => void }) {
  const [data, setData] = useState<AddressHistory | null>(null), [error, setError] = useState('');
  useEffect(() => { let live = true; fetchAddress(token, address).then(d => { if (live) setData(d); }).catch(() => { if (live) setError('이 IP의 기록을 불러오지 못했어요.'); }); return () => { live = false; }; }, [token, address]);
  const peak = data ? Math.max(1, ...data.days.map(d => d.count)) : 1;
  return <Drawer title={<span className="mono">{address}</span>} sub="최근 30일 · 이 화면을 연 기록이 조치 기록에 남아요" onClose={onClose}>
    {error ? <div className="notice warning" role="alert"><div><strong>{error}</strong></div></div> : !data ? <p className="ac-empty">불러오는 중…</p> : <>
      <Facts rows={[['전체', `${data.total}번`], ['처음', kstShort(data.first)], ['마지막', kstShort(data.last)],
        ...Object.entries(data.events).map(([k, n]) => [EVENT_LABEL[k] || k, `${n}번`] as [string, string])]} />
      <h3 className="ac-sub">날짜별</h3>
      <ul className="ac-daybars">{data.days.map(d => <li key={d.day}><span>{d.day.slice(5)}</span><i aria-hidden="true"><u style={{ width: `${d.count / peak * 100}%` }} /></i><b>{d.count}</b></li>)}</ul>
      <button type="button" className="button secondary compact" onClick={onOnly}>이 IP 기록만 목록에서 보기</button>
    </>}
  </Drawer>;
}
