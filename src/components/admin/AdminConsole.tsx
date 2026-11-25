import { useEffect, useState, type ComponentType } from 'react';
import { Activity, ArrowLeft, BarChart3, ClipboardList, Globe, Inbox, LayoutDashboard, Library, RefreshCw, Sparkles, Users } from 'lucide-react';
import { fetchOverview } from '../../api/admin';
import { AdminFeedback } from '../AdminFeedback';
import { AdminReports } from '../AdminReports';
import { AdminStats } from '../AdminStats';
import { AdminAccess } from '../AdminAccess';
import { AdminAi } from './AdminAi';
import { AdminAudit } from './AdminAudit';
import { AdminContent } from './AdminContent';
import { AdminMembers } from './AdminMembers';
import { AdminOverview } from './AdminOverview';
import { AdminSystem } from './AdminSystem';
import { Segmented } from './common';
import '../../styles/admin.css';

// The admin console (#/admin/<section>, 2026-11-26): a screen of its own, apart from the app's menus, with a menu on the
// left (across the top on a narrow screen) and a bar with the section's name, its period and a refresh. What an admin
// may read is decided by the server on every request; this only lays it out.
export type Section = 'overview' | 'stats' | 'members' | 'inbox' | 'ai' | 'access' | 'content' | 'system' | 'audit';
const SECTIONS: { id: Section; label: string; icon: ComponentType<{ size?: number }>; about: string; group: string }[] = [
  { id: 'overview', label: '개요', icon: LayoutDashboard, about: '지난 기간과 비교한 지표, 하루 추이, 처리할 일', group: '한눈에' },
  { id: 'stats', label: '이용 통계', icon: BarChart3, about: '기능별 이용 횟수와 날짜별 표', group: '한눈에' },
  { id: 'inbox', label: '문의함', icon: Inbox, about: '오류 신고와 의견을 확인하고 처리해요', group: '운영' },
  { id: 'members', label: '회원', icon: Users, about: '회원을 찾고 상태를 보고 조치해요', group: '운영' },
  { id: 'content', label: '콘텐츠', icon: Library, about: '메뉴와 곡을 찾고, 문제 있는 항목을 숨겨요', group: '운영' },
  { id: 'ai', label: '추천·AI', icon: Sparkles, about: '추천이 어떻게 나갔는지, AI 사용과 응답 시간', group: '서비스' },
  { id: 'access', label: '접속 기록', icon: Globe, about: '30일 동안의 접속 IP와 시각', group: '서비스' },
  { id: 'system', label: '운영 상태', icon: Activity, about: '서버·데이터베이스, 오늘 쓴 한도, 화면 오류', group: '서비스' },
  { id: 'audit', label: '조치 기록', icon: ClipboardList, about: '관리자가 바꾸고 열어 본 기록', group: '서비스' },
];
export const sectionIn = (hash: string): Section => (SECTIONS.find(s => hash === `#/admin/${s.id}`)?.id) || 'overview';

export function AdminConsole({ token, email, onExit }: { token?: string; email?: string; onExit: () => void }) {
  const [section, setSection] = useState<Section>(() => sectionIn(window.location.hash));
  const [days, setDays] = useState(30), [stamp, setStamp] = useState(0), [badges, setBadges] = useState({ inbox: 0, system: 0 }), [updated, setUpdated] = useState(new Date());
  useEffect(() => {
    const hash = section === 'overview' ? '#/admin' : `#/admin/${section}`;
    if (window.location.hash !== hash) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
    document.title = `${SECTIONS.find(s => s.id === section)?.label} · 관리 · 지금 추천`;
    document.getElementById('admin-main')?.focus();
  }, [section]);
  const [appTitle] = useState(() => document.title);
  useEffect(() => () => { document.title = appTitle; }, [appTitle]);  // the app's own title again on the way out
  useEffect(() => {
    if (!token) return;
    let live = true;
    fetchOverview(token, 7).then(o => { if (live) setBadges({ inbox: o.todo.openReports + o.todo.newFeedback, system: o.todo.clientErrorsToday }); }).catch(() => { /* the sections say what failed */ });
    setUpdated(new Date());
    return () => { live = false; };
  }, [token, stamp]);
  const current = SECTIONS.find(s => s.id === section)!;
  const groups = [...new Set(SECTIONS.map(s => s.group))];
  return <div className="admin-console">
    <a className="skip-link" href="#admin-main" onClick={e => { e.preventDefault(); document.getElementById('admin-main')?.focus(); }}>본문 바로가기</a>
    <aside className="ac-side">
      <div className="ac-brand"><span className="ac-brand-mark" aria-hidden="true" /><div><b>지금 추천</b><small>관리 콘솔</small></div></div>
      <nav aria-label="관리 메뉴">{groups.map(g => <div key={g} className="ac-nav-group"><p>{g}</p>
        {SECTIONS.filter(s => s.group === g).map(s => <button key={s.id} type="button" className={`ac-nav${section === s.id ? ' active' : ''}`} aria-current={section === s.id ? 'page' : undefined} onClick={() => setSection(s.id)}>
          <s.icon size={18} /><span>{s.label}</span>{s.id === 'inbox' && badges.inbox > 0 && <i className="ac-badge" aria-label={`처리할 것 ${badges.inbox}개`}>{badges.inbox}</i>}
          {s.id === 'system' && badges.system > 0 && <i className="ac-badge rose" aria-label={`오늘 화면 오류 ${badges.system}개`}>{badges.system}</i>}
        </button>)}</div>)}</nav>
      <div className="ac-side-foot">
        {email && <p className="mono" title={email}>{email}</p>}
        <button type="button" className="ac-nav" onClick={onExit}><ArrowLeft size={18} /><span>서비스로 돌아가기</span></button>
      </div>
    </aside>
    <div className="ac-main-wrap">
      <header className="ac-top">
        <div className="ac-title"><h1>{current.label}</h1><p>{current.about}</p></div>
        <div className="ac-top-actions">
          {section === 'overview' && <Segmented label="기간" value={days} options={[[7, '7일'], [30, '30일'], [90, '90일']]} onChange={setDays} />}
          <span className="ac-updated">{updated.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 기준</span>
          <button type="button" className="icon-button" aria-label="새로고침" onClick={() => setStamp(n => n + 1)}><RefreshCw size={18} /></button>
        </div>
      </header>
      {/* Keyed by the token: a sign-in that ends (or changes) drops every section's loaded data, open sheets included. */}
      <main id="admin-main" key={token || 'signed-out'} tabIndex={-1} className={`ac-main section-${section}`}>
        {!token && <div className="notice warning" role="alert"><div><strong>관리자 계정으로 로그인해야 볼 수 있어요.</strong></div></div>}
        {token && <>
        {section === 'overview' && <AdminOverview token={token} days={days} go={setSection} stamp={stamp} />}
        {section === 'stats' && <div className="ac-embed"><AdminStats key={stamp} token={token} /></div>}
        {section === 'inbox' && <div className="ac-grid-inbox" key={stamp}>
          <section className="ac-card ac-panel"><AdminReports bare token={token} onBack={onExit} /></section>
          <section className="ac-card ac-panel"><AdminFeedback token={token} /></section>
        </div>}
        {section === 'members' && <AdminMembers token={token} stamp={stamp} />}
        {section === 'content' && <AdminContent token={token} stamp={stamp} />}
        {section === 'ai' && <AdminAi token={token} stamp={stamp} />}
        {section === 'access' && <section className="ac-card ac-panel" key={stamp}><AdminAccess token={token} /></section>}
        {section === 'system' && <AdminSystem token={token} stamp={stamp} />}
        {section === 'audit' && <AdminAudit token={token} stamp={stamp} />}
        </>}
      </main>
    </div>
  </div>;
}
