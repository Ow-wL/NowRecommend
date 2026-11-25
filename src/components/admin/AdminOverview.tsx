import { useMemo } from 'react';
import { AlertTriangle, Bot, Eye, Inbox, LogIn, MessageSquare, Sparkles, UserPlus } from 'lucide-react';
import { fetchOverview } from '../../api/admin';
import { DayChart } from '../AdminStats';
import { Delta, KpiCard, Meter, Notice, Panel, num, short, useLoad } from './common';
import type { Section } from './AdminConsole';

// 개요 (admin console, 2026-11-26): this period against the one before, the days, and what waits for the admin.
export function AdminOverview({ token, days, go, stamp }: { token?: string; days: number; go: (s: Section) => void; stamp: number }) {
  const { data, error } = useLoad(token ? () => fetchOverview(token, days) : null, `${days}:${stamp}`, '개요');
  const view = useMemo(() => {
    if (!data || data.days !== days) return null;
    const pick = (...names: string[]) => data.series.map(d => names.reduce((n, name) => n + (d.counts[name] || 0), 0));
    return { days: data.series.map(d => d.day), visit: pick('visit'), recommend: pick('recommend:food', 'recommend:music'), food: pick('recommend:food'), music: pick('recommend:music'),
      signup: pick('signup'), login: pick('login'), ai: pick('ai'), errors: pick('client_error') };
  }, [data, days]);
  if (error) return <Notice><strong>{error}</strong></Notice>;
  if (!data || !view) return <div className="ac-skeleton" aria-busy="true">불러오는 중…</div>;
  const k = data.kpis, since = data.trackedSince.ai, todo = data.todo;
  const tracked = (day: string | undefined) => day && view.days[0] < day ? <span className="ac-kpi-hint">{short(day)}부터 셈</span> : undefined;
  return <>
    {(todo.openReports > 0 || todo.newFeedback > 0 || todo.clientErrorsToday > 0) && <div className="ac-todo" role="status">
      <strong>처리할 일</strong>
      {todo.openReports > 0 && <button type="button" onClick={() => go('inbox')}><AlertTriangle size={16} /> 미처리 오류 신고 <b>{todo.openReports}</b></button>}
      {todo.newFeedback > 0 && <button type="button" onClick={() => go('inbox')}><MessageSquare size={16} /> 새 의견 <b>{todo.newFeedback}</b></button>}
      {todo.clientErrorsToday > 0 && <button type="button" onClick={() => go('system')}><AlertTriangle size={16} /> 오늘 화면 오류 <b>{todo.clientErrorsToday}</b></button>}
    </div>}
    <div className="ac-kpis">
      <KpiCard label="방문" tone="sun" icon={<Eye size={16} />} value={num(k.visit.current)} spark={view.visit} delta={<Delta {...k.visit} />} hint="브라우저·하루 기준" />
      <KpiCard label="추천" tone="food" icon={<Sparkles size={16} />} value={num(k.recommend.current)} spark={view.recommend} delta={<Delta {...k.recommend} />} hint={`음식 ${num(view.food.reduce((a, b) => a + b, 0))} · 음악 ${num(view.music.reduce((a, b) => a + b, 0))}`} onClick={() => go('ai')} />
      <KpiCard label="가입" tone="mint" icon={<UserPlus size={16} />} value={num(k.signup.current)} spark={view.signup} delta={<Delta {...k.signup} />} hint={`전체 회원 ${num(data.accounts.total)}`} onClick={() => go('members')} />
      <KpiCard label="로그인" tone="music" icon={<LogIn size={16} />} value={num(k.login.current)} spark={view.login} delta={<Delta {...k.login} />} hint={`최근 7일 로그인 계정 ${num(data.accounts.loggedInWeek)}`} />
      <KpiCard label="AI 호출" tone="music" icon={<Bot size={16} />} value={num(k.ai.current)} spark={view.ai} delta={tracked(since) || <Delta {...k.ai} goodWhenUp={null} />} onClick={() => go('ai')} />
      <KpiCard label="의견·신고" tone="rose" icon={<Inbox size={16} />} value={num(k.feedback.current + k.report.current)} delta={<Delta current={k.feedback.current + k.report.current} previous={k.feedback.previous + k.report.previous} goodWhenUp={null} />} hint={`의견 ${k.feedback.current} · 신고 ${k.report.current}`} onClick={() => go('inbox')} />
    </div>
    <div className="ac-grid-2-1">
      <Panel title="하루 방문과 추천" sub={`최근 ${days}일 · 한국 시간`}>
        <DayChart kind="line" days={view.days} label={`최근 ${days}일 하루 방문과 추천`} series={[
          { name: '방문', color: 'var(--ac-chart-sun)', values: view.visit }, { name: '음식 추천', color: 'var(--ac-chart-food)', values: view.food }, { name: '음악 추천', color: 'var(--ac-chart-music)', values: view.music }]} />
      </Panel>
      <Panel title="회원" sub="지금 기준">
        <ul className="ac-stat-list">
          <li><span>전체</span><b>{num(data.accounts.total)}</b></li>
          <li><span>이메일 확인</span><b>{num(data.accounts.confirmed)}</b></li>
          <li><span>{days}일 안에 가입</span><b>{num(data.accounts.newInPeriod)}</b></li>
          <li><span>최근 7일 로그인 계정</span><b>{num(data.accounts.loggedInWeek)}</b></li>
          <li><span>정지</span><b>{num(data.accounts.suspended)}</b></li>
          <li><span>관리자</span><b>{num(data.accounts.admins)}</b></li>
        </ul>
        <button type="button" className="button secondary compact ac-full" onClick={() => go('members')}>회원 관리로</button>
      </Panel>
    </div>
    <div className="ac-grid-2">
      <Panel title="하루 가입" sub={`최근 ${days}일`}>
        <DayChart kind="bar" days={view.days} label={`최근 ${days}일 하루 가입 수`} series={[{ name: '가입', color: 'var(--ac-chart-mint)', values: view.signup }]} />
      </Panel>
      <Panel title="오늘 쓴 한도" sub="서비스 내부 일일 한도 · 자정(한국)에 다시 시작">
        <div className="ac-meters">{data.quotas.map(q => <Meter key={q.key} label={q.label} used={q.used} limit={q.limit} />)}</div>
      </Panel>
    </div>
    <p className="ac-footnote">방문은 브라우저마다 하루 한 번 세요(같은 사람이 휴대폰과 PC로 오면 2). 변화는 바로 앞 {days}일과 비교한 값이에요.</p>
  </>;
}
