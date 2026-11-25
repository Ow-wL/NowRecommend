import { CheckCircle2, CircleSlash, Database, Server } from 'lucide-react';
import { fetchSystem } from '../../api/admin';
import { DayChart } from '../AdminStats';
import { Facts, KpiCard, Meter, Notice, Panel, kst, num, short, useLoad } from './common';

// 운영 상태 (admin console, 2026-11-26): which server and database answer, what is switched on, today's limits, and how
// many errors browsers sent (their text stays in the server log).
export function AdminSystem({ token, stamp }: { token?: string; stamp: number }) {
  const { data, error } = useLoad(token ? () => fetchSystem(token) : null, String(stamp), '운영 상태');
  if (error) return <Notice><strong>{error}</strong></Notice>;
  if (!data) return <div className="ac-skeleton" aria-busy="true">불러오는 중…</div>;
  const errorsToday = data.clientErrors[data.clientErrors.length - 1]?.count ?? 0, since = data.trackedSince.client_error;
  return <>
    <div className="ac-kpis four">
      <KpiCard label="서버" tone={data.server.revision ? 'mint' : 'sun'} icon={<Server size={16} />} value={<span className="mono ac-small-value">{data.server.revision || '로컬'}</span>} hint={data.server.service || '개발 서버'} />
      <KpiCard label="데이터베이스" tone={data.database.ok ? 'mint' : 'rose'} icon={<Database size={16} />} value={data.database.ok ? `리비전 ${data.database.revision ?? '-'}` : '연결 안 됨'} hint={`pgvector ${data.database.pgvector || '-'}`} />
      <KpiCard label="오늘 화면 오류" tone={errorsToday ? 'rose' : 'mint'} icon={<CircleSlash size={16} />} value={num(errorsToday)} spark={data.clientErrors.map(d => d.count)} hint={since ? `${short(since)}부터 셈 · 내용은 서버 로그에` : undefined} />
      <KpiCard label="서버 시각" tone="sun" icon={<CheckCircle2 size={16} />} value={<span className="ac-small-value">{kst(data.server.now)}</span>} hint="한국 시간" />
    </div>
    <div className="ac-grid-2">
      <Panel title="오늘 쓴 한도" sub="서비스 내부 일일 한도 · 자정(한국)에 다시 시작">
        <div className="ac-meters">{data.quotas.map(q => <Meter key={q.key} label={q.label} used={q.used} limit={q.limit} />)}</div>
      </Panel>
      <Panel title="연결과 설정" sub="서버 환경 변수 기준">
        <ul className="ac-switches">{data.integrations.map(i => <li key={i.key}><span>{i.label}</span>{i.on ? <b className="on">켜짐</b> : <b className="off">꺼짐</b>}</li>)}</ul>
        <Facts rows={[['회원 하루 AI 추천', `${num(data.limits.aiPerMember)}회`], ['손님 하루 AI 추천', `${num(data.limits.aiPerGuest)}회`],
          ['분당 요청(회원·손님)', `${num(data.limits.perMinute)} · ${num(data.limits.perMinuteGuest || data.limits.perMinute)}`]]} />
      </Panel>
    </div>
    <div className="ac-grid-2">
      <Panel title="화면 오류" sub="최근 14일 · 브라우저가 보낸 오류 수">
        <DayChart kind="bar" days={data.clientErrors.map(d => d.day)} label="최근 14일 하루 화면 오류 수" series={[{ name: '오류', color: 'var(--ac-chart-food)', values: data.clientErrors.map(d => d.count) }]} />
      </Panel>
      <Panel title="보관 기간" sub="개인정보 처리방침과 같아요">
        <ul className="ac-stat-list">{data.retention.map(r => <li key={r.label}><span>{r.label}</span><b>{r.days}일</b></li>)}</ul>
      </Panel>
    </div>
  </>;
}
