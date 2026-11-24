import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { AdminAccess } from './AdminAccess';
import { AdminFeedback } from './AdminFeedback';
import { AdminInsights } from './AdminInsights';
import { AdminReports } from './AdminReports';
import { AdminStats } from './AdminStats';

type Tab = 'stats' | 'access' | 'reports' | 'feedback';
const TABS: [Tab, string][] = [['stats', '통계'], ['access', '접속 기록'], ['reports', '오류 신고'], ['feedback', '의견']];

// The admin page (#/admin, 2026-11-23): usage numbers first, then what people sent. The server decides who may read each.
export function AdminPage({ token, onBack }: { token?: string; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('stats');
  return <>
    <div className="flow-head">
      <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> 내 취향으로</button>
      <h1>관리</h1>
      <p>이용 통계와 접속 기록을 보고, 사용자가 보낸 오류 신고와 의견을 처리해요.</p>
      <div className="filter-tabs admin-tabs" role="tablist" aria-label="관리 구역">{TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</div>
    </div>
    {tab === 'stats' && <div className="flow-body neutral-scope"><AdminStats token={token} /><AdminInsights token={token} /></div>}
    {tab === 'access' && <AdminAccess token={token} />}
    {tab === 'reports' && <AdminReports bare token={token} onBack={onBack} />}
    {tab === 'feedback' && <AdminFeedback token={token} />}
  </>;
}
