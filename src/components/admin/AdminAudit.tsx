import { useCallback, useEffect, useRef, useState } from 'react';
import { ACTION_LABEL, fetchAudit, type AuditEntry } from '../../api/admin';
import { Notice, Panel, Pill, errorText, kst } from './common';

// 조치 기록 (admin console, 2026-11-26): every change an admin made, and every look at one member or one address.
const TARGET: Record<string, string> = { member: '회원', item: '항목', feedback: '의견', report: '신고', address: 'IP' };
const ACTIONS: [string, string][] = [['', '모든 조치'], ...Object.entries(ACTION_LABEL)];

export function AdminAudit({ token, stamp }: { token?: string; stamp: number }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]), [more, setMore] = useState(false), [action, setAction] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const asked = useRef(0);
  const load = useCallback(async (before?: number) => {
    if (!token) { setError('관리자 계정으로 로그인해야 볼 수 있어요.'); return; }
    const mine = ++asked.current;
    setBusy(true);
    try { const page = await fetchAudit(token, { before, action }); if (mine === asked.current) { setEntries(list => before ? [...list, ...page.entries] : page.entries); setMore(page.more); setError(''); } }
    catch (err) { if (mine === asked.current) setError(errorText(err, '조치 기록')); }
    finally { if (mine === asked.current) setBusy(false); }
  }, [token, action]);
  useEffect(() => { void load(); }, [load, stamp]);
  return <Panel title="관리자 조치 기록" sub="정지·숨김·처리 같은 변경과, 회원 정보·IP 기록을 연 것이 남아요. 2년 보관해요."
    actions={<label className="ac-select"><span className="sr-only">조치 종류</span><select value={action} onChange={e => setAction(e.target.value)}>{ACTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>}>
    {error ? <Notice><strong>{error}</strong></Notice> : <>
      <div className="ac-table-wrap"><table className="ac-table">
        <thead><tr><th scope="col">시각</th><th scope="col">누가</th><th scope="col">무엇을</th><th scope="col">대상</th><th scope="col">이유</th></tr></thead>
        <tbody>{entries.map(a => <tr key={a.id}>
          <td>{kst(a.at)}</td><td className="mono small">{a.actor}</td>
          <td>{a.action.startsWith('view_') ? <Pill tone="ink">{ACTION_LABEL[a.action] || a.action}</Pill> : <Pill tone={a.action === 'suspend' || a.action === 'hide_item' || a.action === 'feedback_delete' ? 'rose' : 'mint'}>{ACTION_LABEL[a.action] || a.action}</Pill>}</td>
          <td className="small">{TARGET[a.targetType] || a.targetType} <span className="mono">{typeof a.detail.name === 'string' ? a.detail.name : typeof a.detail.who === 'string' ? a.detail.who : a.targetId.length > 20 ? `${a.targetId.slice(0, 8)}…` : a.targetId}</span></td>
          <td className="ac-wrap">{a.reason || '-'}</td>
        </tr>)}</tbody>
      </table></div>
      {!entries.length && !busy && <p className="ac-empty">아직 기록이 없어요.</p>}
      {more && <button type="button" className="button secondary compact" disabled={busy} onClick={() => void load(entries[entries.length - 1]?.id)}>더 보기</button>}
    </>}
  </Panel>;
}
