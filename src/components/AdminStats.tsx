import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { ApiError } from '../api/client';
import { fetchStats, type StatsBoard } from '../api/stats';

// The admin dashboard (#/admin, 통계 tab, 2026-11-23): daily counts the server keeps (server/app/stats.py). Nothing here
// names a person: a visit is a browser's first open of the day, a feature is a count of uses.
const PERIODS = [7, 30, 90] as const;
const FEATURES: [string, string][] = [
  ['recommend:food', '음식 추천'], ['recommend:music', '음악 추천'], ['pair', '음식·음악 짝꿍'], ['type:food', '음식 취향 유형 테스트'],
  ['type:music', '음악 취향 유형 테스트'], ['youtube', 'YouTube 재생'], ['signup', '가입'], ['verify', '이메일 확인'], ['login', '로그인'],
  ['feedback', '의견 보내기'], ['report', '오류 신고'],
];
const sum = (board: StatsBoard, name: string) => board.days.reduce((n, d) => n + (d.counts[name] || 0), 0);
const short = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
const nice = (max: number) => { if (max <= 4) return 4; const step = 10 ** Math.floor(Math.log10(max)); return Math.ceil(max / step) * step; };

type Tip = { x: number; y: number; lines: string[] } | null;
const W = 640, H = 200, PAD = { top: 12, right: 16, bottom: 26, left: 34 };

/** One measure per day as bars, or several as lines. The y axis starts at 0; every day has a hover target as tall as the plot. */
export function DayChart({ days, series, kind, label }: { days: string[]; series: { name: string; color: string; values: number[] }[]; kind: 'bar' | 'line'; label: string }) {
  const [tip, setTip] = useState<Tip>(null), [focus, setFocus] = useState(-1);
  const max = nice(Math.max(1, ...series.flatMap(s => s.values)));
  const iw = W - PAD.left - PAD.right, ih = H - PAD.top - PAD.bottom, step = iw / days.length;
  const x = (n: number) => PAD.left + step * n + step / 2, y = (v: number) => PAD.top + ih - (v / max) * ih;
  const every = Math.ceil(days.length / 7);
  const show = (n: number) => { setFocus(n); setTip({ x: x(n) / W * 100, y: 0, lines: [short(days[n]), ...series.map(s => `${s.name} ${s.values[n]}`)] }); };
  const bar = Math.max(2, Math.min(18, step - 2));
  return <figure className="stats-chart" aria-label={label}>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onMouseLeave={() => { setTip(null); setFocus(-1); }}>
      {[0, max / 2, max].map(v => <g key={v}><line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="stats-grid" /><text x={PAD.left - 6} y={y(v) + 4} className="stats-axis" textAnchor="end">{v}</text></g>)}
      {days.map((d, n) => n % every === 0 && <text key={d} x={x(n)} y={H - 8} className="stats-axis" textAnchor="middle">{short(d)}</text>)}
      {kind === 'bar' ? series[0].values.map((v, n) => v > 0 && <path key={n} fill={series[0].color} opacity={focus === -1 || focus === n ? 1 : .45}
        d={`M${x(n) - bar / 2},${y(0)} V${y(v) + Math.min(4, (y(0) - y(v)) / 2)} q0,-4 4,-4 h${bar - 8} q4,0 4,4 V${y(0)} Z`} />)
        : series.map(s => <polyline key={s.name} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" points={s.values.map((v, n) => `${x(n)},${y(v)}`).join(' ')} />)}
      {kind === 'line' && focus >= 0 && <line x1={x(focus)} x2={x(focus)} y1={PAD.top} y2={PAD.top + ih} className="stats-cross" />}
      {kind === 'line' && focus >= 0 && series.map(s => <circle key={s.name} cx={x(focus)} cy={y(s.values[focus])} r={4.5} fill={s.color} className="stats-dot" />)}
      {days.map((d, n) => <rect key={d} x={PAD.left + step * n} y={PAD.top} width={step} height={ih} fill="transparent" onMouseEnter={() => show(n)} />)}
    </svg>
    {tip && <div className="stats-tip" style={{ left: `${tip.x}%` }} role="status">{tip.lines.map((l, i) => <span key={i}>{l}</span>)}</div>}
    {series.length > 1 && <figcaption className="stats-legend">{series.map(s => <span key={s.name}><i style={{ background: s.color }} aria-hidden="true" />{s.name}</span>)}</figcaption>}
  </figure>;
}

export function AdminStats({ token }: { token?: string }) {
  const [days, setDays] = useState<number>(30), [board, setBoard] = useState<StatsBoard | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const asked = useRef(0);
  const load = useCallback(async (period: number) => {
    if (!token) { setError('관리자 계정으로 로그인해야 볼 수 있어요.'); return; }
    const mine = ++asked.current;
    setBusy(true);
    try { const next = await fetchStats(token, period); if (mine === asked.current) { setBoard(next); setError(''); } }
    catch (err) { if (mine === asked.current) setError(err instanceof ApiError && (err.status === 401 || err.status === 403) ? '관리자 계정으로 로그인해야 볼 수 있어요.' : '통계를 불러오지 못했어요.'); }
    finally { if (mine === asked.current) setBusy(false); }
  }, [token]);
  useEffect(() => { void load(days); }, [days, load]);
  const dark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light' || document.documentElement.dataset.theme === 'dark';
  const colors = dark ? { food: '#D9714F', music: '#4A8BD6' } : { food: '#C4623F', music: '#2F6FB5' };  // checked with the dataviz validator, both modes
  const view = useMemo(() => {
    if (!board || board.days.length !== days) return null;  // the other period's numbers are not shown under this one's label
    const list = board.days.map(d => d.day), today = board.days[board.days.length - 1]?.counts || {};
    const features = FEATURES.map(([name, label]) => ({ name, label, total: sum(board, name) })).sort((a, b) => b.total - a.total);
    return { list, today, features, top: Math.max(1, ...features.map(f => f.total)),
      visits: board.days.map(d => d.counts.visit || 0), food: board.days.map(d => d.counts['recommend:food'] || 0), music: board.days.map(d => d.counts['recommend:music'] || 0) };
  }, [board]);
  return <section className="admin-stats" aria-labelledby="admin-stats-title">
    <div className="report-toolbar">
      <h2 id="admin-stats-title">이용 통계</h2>
      <div className="filter-tabs" role="group" aria-label="기간">{PERIODS.map(p => <button key={p} aria-pressed={days === p} className={days === p ? 'active' : ''} onClick={() => setDays(p)}>{p}일</button>)}</div>
      <button className="icon-button" aria-label="통계 새로고침" disabled={busy} onClick={() => void load(days)}><RefreshCw size={18} /></button>
    </div>
    {error ? <div className="notice warning" role="alert"><div><strong>{error}</strong></div></div> : board && view && <>
      <div className="stats-tiles">
        <div className="stats-tile"><small>오늘 방문</small><b>{view.today.visit || 0}</b><span>브라우저 수</span></div>
        <div className="stats-tile"><small>{days}일 방문</small><b>{sum(board, 'visit')}</b><span>하루 단위 합계</span></div>
        <div className="stats-tile"><small>{days}일 추천</small><b>{sum(board, 'recommend:food') + sum(board, 'recommend:music')}</b><span>음식 {sum(board, 'recommend:food')} · 음악 {sum(board, 'recommend:music')}</span></div>
        <div className="stats-tile"><small>계정</small><b>{board.totals.accounts}</b><span>이메일 확인 {board.totals.confirmedAccounts}</span></div>
        <div className="stats-tile"><small>처리할 일</small><b>{board.totals.openReports}</b><span>미처리 신고 · 의견 {board.totals.feedback}</span></div>
      </div>
      <div className="stats-panel"><h3>하루 방문</h3><DayChart kind="bar" days={view.list} label={`최근 ${days}일 하루 방문 수`} series={[{ name: '방문', color: 'var(--text-secondary)', values: view.visits }]} /></div>
      <div className="stats-panel"><h3>하루 추천</h3><DayChart kind="line" days={view.list} label={`최근 ${days}일 음식·음악 추천 수`} series={[{ name: '음식', color: colors.food, values: view.food }, { name: '음악', color: colors.music, values: view.music }]} /></div>
      <div className="stats-panel"><h3>기능별 이용 <small>{days}일 합계</small></h3>
        <ul className="stats-bars">{view.features.map(f => <li key={f.name}><span>{f.label}</span><i aria-hidden="true"><u style={{ width: `${f.total / view.top * 100}%` }} /></i><b>{f.total}</b></li>)}</ul>
      </div>
      <details className="stats-table"><summary>날짜별 표로 보기</summary>
        <div className="table-scroll"><table><thead><tr><th scope="col">날짜</th><th scope="col">방문</th>{FEATURES.map(([n, l]) => <th key={n} scope="col">{l}</th>)}</tr></thead>
          <tbody>{[...board.days].reverse().map(d => <tr key={d.day}><th scope="row">{short(d.day)}</th><td>{d.counts.visit || 0}</td>{FEATURES.map(([n]) => <td key={n}>{d.counts[n] || 0}</td>)}</tr>)}</tbody></table></div>
      </details>
      <p className="muted small">방문은 브라우저마다 하루 한 번 세요(같은 사람이 휴대폰과 PC로 오면 2). 개인을 알아볼 수 있는 정보는 남기지 않아요.</p>
    </>}
  </section>;
}
