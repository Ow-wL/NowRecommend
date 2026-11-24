import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { ApiError } from '../api/client';
import { feedbackKinds } from '../api/feedback';
import { fetchInsights, type CategoryInsight, type Insights } from '../api/stats';

// More of what the server already keeps (2026-11-24, GET /api/admin/insights): how recommendations went, what was asked and
// recommended most, when people came, accounts, the AI's day, and the busiest addresses (the 30-day access list).
const PERIODS = [1, 7, 30] as const;
const ISSUE_LABEL: Record<string, string> = {
  extra: '예비 후보 남음', short: '목표보다 적게 나옴', store_missing: '스토어에 없는 곡', store_unknown: '스토어 확인 못 함', duplicate: '중복 제거',
  blocked: '본 항목·제외 항목 걸러냄', blocked_id: '이미 본 항목(같은 곡 다른 표기)', reference: '기준곡 자체 제외', reference_artist: '기준 아티스트 2곡째 제외',
  out_of_years: '발매 연도 밖', excluded_value: '제외 조건 위반', excluded_by_name: '이름으로 본 제외 위반', incomplete: '정보 빠진 답', malformed: '형식 오류',
  unknown_tag: '모르는 태그', duplicate_id: '같은 항목으로 합쳐짐',
};
const FEEDBACK_LABEL = Object.fromEntries(feedbackKinds) as Record<string, string>;
const REPORT_LABEL: Record<string, string> = { open: '미처리', resolved: '처리함', dismissed: '넘김' };
const EVENT_LABEL: Record<string, string> = { food: '음식', music: '음악' };
const ms = (v: number | null) => v === null ? '-' : v >= 1000 ? `${(v / 1000).toFixed(1)}초` : `${v}ms`;
const pct = (a: number, b: number) => b ? `${Math.round(a / b * 100)}%` : '-';
const kst = (iso: string) => new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function CategoryBlock({ name, c }: { name: string; c: CategoryInsight }) {
  const issues = Object.entries(c.issues).filter(([k]) => k !== 'extra');
  return <div className="stats-panel insight-category">
    <h3>{EVENT_LABEL[name] || name} 추천 <small>{c.requests}회</small></h3>
    <div className="stats-tiles compact">
      <div className="stats-tile"><small>AI가 답함</small><b>{pct(c.ai, c.requests)}</b><span>목록으로 대신 {c.fallback}회</span></div>
      <div className="stats-tile"><small>응답 시간</small><b>{ms(c.latencyP50)}</b><span>느린 쪽(95%) {ms(c.latencyP95)}</span></div>
      <div className="stats-tile"><small>오류</small><b>{c.errors}</b><span>요청 중 실패</span></div>
    </div>
    <div className="insight-columns">
      <div><h4>가장 많이 나온 {name === 'music' ? '곡' : '메뉴'}</h4>
        {c.topItems.length ? <ol className="insight-list">{c.topItems.map(i => <li key={i.id}><span>{i.name}{i.artist && <small> · {i.artist}</small>}</span><b>{i.count}</b></li>)}</ol> : <p className="muted small">아직 없어요.</p>}</div>
      <div><h4>많이 고른 조건</h4>
        {c.topTags.length ? <ol className="insight-list">{c.topTags.map(t => <li key={t.tag}><span>{t.tag}</span><b>{t.count}</b></li>)}</ol> : <p className="muted small">아직 없어요.</p>}
        {c.topExcluded.length > 0 && <><h4>많이 뺀 조건</h4><ol className="insight-list">{c.topExcluded.map(t => <li key={t.tag}><span>{t.tag} 제외</span><b>{t.count}</b></li>)}</ol></>}</div>
      <div><h4>AI 답 점검 <small>건수</small></h4>
        {issues.length ? <ul className="insight-list">{issues.map(([k, n]) => <li key={k}><span>{ISSUE_LABEL[k] || k}</span><b>{n}</b></li>)}</ul> : <p className="muted small">걸린 것이 없어요.</p>}</div>
    </div>
  </div>;
}

export function AdminInsights({ token }: { token?: string }) {
  const [days, setDays] = useState<number>(7), [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const asked = useRef(0);
  const load = useCallback(async (period: number) => {
    if (!token) return;
    const mine = ++asked.current;
    setBusy(true);
    try { const next = await fetchInsights(token, period); if (mine === asked.current) { setData(next); setError(''); } }
    catch (err) { if (mine === asked.current) setError(err instanceof ApiError && (err.status === 401 || err.status === 403) ? '' : '자세한 통계를 불러오지 못했어요.'); }
    finally { if (mine === asked.current) setBusy(false); }
  }, [token]);
  useEffect(() => { void load(days); }, [days, load]);
  if (!token) return null;
  const view = data && data.days === days ? data : null;
  const peak = view ? Math.max(1, ...view.hours) : 1;
  return <section className="admin-stats admin-insights" aria-labelledby="admin-insights-title">
    <div className="report-toolbar">
      <h2 id="admin-insights-title">자세히 보기</h2>
      <div className="filter-tabs" role="group" aria-label="자세히 보기 기간">{PERIODS.map(p => <button key={p} aria-pressed={days === p} className={days === p ? 'active' : ''} onClick={() => setDays(p)}>{p === 1 ? '오늘' : `${p}일`}</button>)}</div>
      <button className="icon-button" aria-label="자세한 통계 새로고침" disabled={busy} onClick={() => void load(days)}><RefreshCw size={18} /></button>
    </div>
    {error ? <div className="notice warning" role="alert"><div><strong>{error}</strong></div></div> : view && <>
      <div className="stats-tiles">
        <div className="stats-tile"><small>오늘 AI 사용</small><b>{view.ai.usedToday}</b><span>{view.ai.dailyLimit > 0 ? `하루 한도 ${view.ai.dailyLimit} 중 ${pct(view.ai.usedToday, view.ai.dailyLimit)}` : '하루 한도 없음'}</span></div>
        <div className="stats-tile"><small>접속한 IP</small><b>{view.access.addressesToday}</b><span>오늘 · 기간 {view.access.addressesInPeriod}</span></div>
        <div className="stats-tile"><small>새 계정</small><b>{view.accounts.newInPeriod}</b><span>전체 {view.accounts.total} · 확인 {view.accounts.confirmed}</span></div>
        <div className="stats-tile"><small>최근 7일 로그인</small><b>{view.accounts.activeWeek}</b><span>기록 저장 계정 {view.accounts.withSavedData} · 관리자 {view.accounts.admins}</span></div>
      </div>
      {(['food', 'music'] as const).map(c => view.recommendations[c] && <CategoryBlock key={c} name={c} c={view.recommendations[c]!} />)}
      {!view.recommendations.food && !view.recommendations.music && <p className="muted small">이 기간에는 추천 기록이 없어요.</p>}
      <div className="stats-panel"><h3>시간대별 추천 <small>한국 시간</small></h3>
        <div className="hour-bars" role="img" aria-label={`시간대별 추천 수: ${view.hours.map((n, h) => `${h}시 ${n}`).join(', ')}`}>
          {view.hours.map((n, h) => <span key={h} title={`${h}시 ${n}회`}><i style={{ height: `${n / peak * 100}%` }} /><small>{h % 3 === 0 ? h : ''}</small></span>)}
        </div>
      </div>
      <div className="insight-columns">
        <div className="stats-panel"><h3>가장 많이 들어온 IP <small>{days === 1 ? '오늘' : `${days}일`}</small></h3>
          {view.access.busiest.length ? <ol className="insight-list mono">{view.access.busiest.map(a => <li key={a.address}><span>{a.address}<small> · 마지막 {kst(a.last)}</small></span><b>{a.count}</b></li>)}</ol> : <p className="muted small">아직 없어요.</p>}</div>
        <div className="stats-panel"><h3>의견과 신고</h3>
          <ul className="insight-list">{Object.entries(view.feedbackKinds).map(([k, n]) => <li key={k}><span>의견 · {FEEDBACK_LABEL[k] || k}</span><b>{n}</b></li>)}
            {Object.entries(view.reportStatus).map(([k, n]) => <li key={k}><span>오류 신고 · {REPORT_LABEL[k] || k}</span><b>{n}</b></li>)}</ul></div>
      </div>
    </>}
  </section>;
}
