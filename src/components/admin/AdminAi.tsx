import { useMemo, useState } from 'react';
import { Bot, Clock, ListChecks, TriangleAlert } from 'lucide-react';
import { fetchRecommendations } from '../../api/admin';
import { AdminInsights } from '../AdminInsights';
import { DayChart } from '../AdminStats';
import { KpiCard, Notice, Panel, Pill, Segmented, kst, ms, num, percent, short, useLoad } from './common';

// 추천·AI (admin console, 2026-11-26): how recommendations went day by day, and the latest requests of one kind. No request
// text, account or address: conditions, engine, speed and error codes only (privacy policy: 추천 요청 내용).
const PERIODS: [number, string][] = [[7, '7일'], [30, '30일'], [90, '90일']];
const KINDS: [('all' | 'failed' | 'catalog'), string][] = [['all', '전체'], ['catalog', '목록으로 대신 답함'], ['failed', '오류 있음']];
const CATEGORIES: [('all' | 'food' | 'music'), string][] = [['all', '음식·음악'], ['food', '음식'], ['music', '음악']];

export function AdminAi({ token, stamp }: { token?: string; stamp: number }) {
  const [days, setDays] = useState(30), [kind, setKind] = useState<'all' | 'failed' | 'catalog'>('all'), [category, setCategory] = useState<'all' | 'food' | 'music'>('all'), [page, setPage] = useState(1);
  const { data, error, busy } = useLoad(token ? () => fetchRecommendations(token, { days, kind, category, page }) : null, `${days}|${kind}|${category}|${page}|${stamp}`, '추천 기록');
  const view = useMemo(() => data && data.days === days ? data : null, [data, days]);
  if (error) return <Notice><strong>{error}</strong></Notice>;
  const s = view?.summary, since = view?.trackedSince.ai;
  return <>
    <div className="ac-toolbar">
      <Segmented label="기간" value={days} options={PERIODS} onChange={v => { setDays(v); setPage(1); }} />
      <Segmented label="분야" value={category} options={CATEGORIES} onChange={v => { setCategory(v); setPage(1); }} />
    </div>
    {!view || !s ? <div className="ac-skeleton" aria-busy="true">불러오는 중…</div> : <>
      <div className="ac-kpis four">
        <KpiCard label="추천 요청" tone="food" icon={<ListChecks size={16} />} value={num(s.requests)} spark={view.trend.map(t => t.requests)} hint={`AI ${num(s.ai)} · 목록 ${num(s.catalog)}`} />
        <KpiCard label="AI가 답한 비율" tone="music" icon={<Bot size={16} />} value={percent(s.ai, s.requests)} spark={view.trend.map(t => t.requests ? t.ai / t.requests : 0)} hint={`AI 호출 ${num(s.aiCalls)}회${since && view.trend[0].day < since ? ` (${short(since)}부터 셈)` : ''}`} />
        <KpiCard label="응답 시간" tone="sun" icon={<Clock size={16} />} value={ms(s.p50)} spark={view.trend.map(t => t.p50 || 0)} hint={`느린 쪽(95%) ${ms(s.p95)}`} />
        <KpiCard label="오류가 난 요청" tone="rose" icon={<TriangleAlert size={16} />} value={num(s.errors)} spark={view.trend.map(t => t.errors)} hint={percent(s.errors, s.requests)} />
      </div>
      <div className="ac-grid-2">
        <Panel title="AI 답과 목록 답" sub="하루 요청 수">
          <DayChart kind="line" days={view.trend.map(t => t.day)} label="하루 AI 답과 목록 답" series={[{ name: 'AI', color: 'var(--ac-chart-music)', values: view.trend.map(t => t.ai) }, { name: '목록으로 대신', color: 'var(--ac-chart-sun)', values: view.trend.map(t => t.catalog) }]} />
        </Panel>
        <Panel title="응답 시간" sub="하루 중간값과 느린 쪽(95%), 밀리초">
          <DayChart kind="line" days={view.trend.map(t => t.day)} label="하루 응답 시간" series={[{ name: '중간값', color: 'var(--ac-chart-mint)', values: view.trend.map(t => t.p50 || 0) }, { name: '느린 쪽', color: 'var(--ac-chart-food)', values: view.trend.map(t => t.p95 || 0) }]} />
        </Panel>
      </div>
      <Panel title="최근 추천 요청" sub="입력 문장 원문은 저장하지 않아요. 조건과 결과만 보여요." actions={<Segmented label="요청 거르기" value={kind} options={KINDS} onChange={v => { setKind(v); setPage(1); }} />}>
        <div className="ac-table-wrap"><table className="ac-table">
          <thead><tr><th scope="col">시각</th><th scope="col">분야</th><th scope="col">답</th><th scope="col">조건</th><th scope="col">결과</th><th scope="col">시간</th><th scope="col">점검·오류</th></tr></thead>
          <tbody>{view.recent.map(r => <tr key={r.id}>
            <td>{kst(r.at)}</td><td>{r.category === 'food' ? <Pill tone="food">음식</Pill> : <Pill tone="music">음악</Pill>}</td>
            <td>{r.engine === 'ai' ? 'AI' : '목록'}</td>
            <td className="ac-wrap">{[...r.tags, ...r.excluded.map(t => `${t} 제외`)].join(', ') || '-'}</td>
            <td>{r.results}개</td><td>{ms(r.latencyMs)}</td>
            <td className="ac-wrap mono small">{r.error ? <span className="ac-error-code">{r.error}</span> : r.issues || '-'}</td>
          </tr>)}</tbody>
        </table></div>
        {!view.recent.length && <p className="ac-empty">이 조건의 요청이 없어요.</p>}
        <div className="ac-pager"><button type="button" className="button secondary compact" disabled={busy || page <= 1} onClick={() => setPage(p => p - 1)}>최신 쪽</button>
          <b>{page}쪽</b><button type="button" className="button secondary compact" disabled={busy || !view.more} onClick={() => setPage(p => p + 1)}>이전 기록</button></div>
      </Panel>
    </>}
    <div className="ac-embed"><AdminInsights token={token} /></div>
  </>;
}
