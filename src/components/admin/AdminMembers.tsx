import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Search, ShieldCheck } from 'lucide-react';
import { ACTION_LABEL, fetchMember, searchMembers, setMemberAdmin, signOutMember, suspendMember, unsuspendMember, type Member, type MemberFilter, type MemberSort } from '../../api/admin';
import { Drawer, Facts, Notice, Pager, Panel, Pill, Segmented, ago, errorText, kst, kstDay, num, useLoad } from './common';
import { ApiError } from '../../api/client';

// 회원 (admin console, 2026-11-26). The list masks addresses (the server does); one member's details show the whole
// address and are recorded as looked at. Saved data is shown as counts only.
const FILTERS: [MemberFilter, string][] = [['all', '전체'], ['confirmed', '확인됨'], ['unconfirmed', '미확인'], ['withData', '저장 데이터 있음'], ['suspended', '정지'], ['admin', '관리자']];
const COUNT_LABEL: Record<string, string> = { liked: '좋아하는 항목', favorites: '즐겨찾기', history: '추천 기록', presets: '저장한 조건', tasteTypes: '취향 유형 결과' };

export function AdminMembers({ token, stamp }: { token?: string; stamp: number }) {
  const [draft, setDraft] = useState(''), [q, setQ] = useState(''), [filter, setFilter] = useState<MemberFilter>('all');
  const [sort, setSort] = useState<MemberSort>('created'), [order, setOrder] = useState<'asc' | 'desc'>('desc'), [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const size = 25;
  const { data, error, busy, reload } = useLoad(token ? () => searchMembers(token, { q, filter, sort, order, page, size }) : null, `${q}|${filter}|${sort}|${order}|${page}|${stamp}`, '회원 목록');
  const submit = (e: FormEvent) => { e.preventDefault(); setPage(1); setQ(draft.trim()); };
  const sortBy = (next: MemberSort) => { if (sort === next) setOrder(o => o === 'desc' ? 'asc' : 'desc'); else { setSort(next); setOrder(next === 'email' ? 'asc' : 'desc'); } setPage(1); };
  const arrow = (col: MemberSort) => sort === col ? (order === 'desc' ? ' ↓' : ' ↑') : '';
  const ariaSort = (col: MemberSort) => sort === col ? (order === 'desc' ? 'descending' : 'ascending') : 'none';
  return <>
    <Panel title="회원 목록" sub="이메일·이름은 일부를 가려 보여줘요. 한 명을 열면 전체가 보이고, 연 기록이 조치 기록에 남아요."
      actions={<form className="ac-search" onSubmit={submit} role="search"><Search size={16} aria-hidden="true" /><label className="sr-only" htmlFor="member-q">이메일이나 이름으로 찾기</label>
        <input id="member-q" type="search" placeholder="이메일이나 이름으로 찾기" value={draft} onChange={e => setDraft(e.target.value)} autoComplete="off" /><button type="submit" className="button secondary compact">찾기</button></form>}>
      <div className="ac-toolbar"><Segmented label="회원 거르기" value={filter} options={FILTERS} onChange={v => { setFilter(v); setPage(1); }} /></div>
      {error ? <Notice><strong>{error}</strong></Notice> : <>
        <div className="ac-table-wrap"><table className="ac-table">
          <thead><tr>
            <th scope="col" aria-sort={ariaSort('email')}><button type="button" onClick={() => sortBy('email')}>이메일{arrow('email')}</button></th>
            <th scope="col">이름</th><th scope="col">상태</th>
            <th scope="col" aria-sort={ariaSort('created')}><button type="button" onClick={() => sortBy('created')}>가입{arrow('created')}</button></th>
            <th scope="col" aria-sort={ariaSort('login')}><button type="button" onClick={() => sortBy('login')}>최근 로그인{arrow('login')}</button></th>
            <th scope="col">저장 데이터</th>
          </tr></thead>
          <tbody>{data?.members.map(m => <tr key={m.id} className={m.suspended ? 'muted-row' : ''}>
            <td><button type="button" className="ac-link mono" onClick={() => setOpen(m.id)}>{m.email}</button></td>
            <td>{m.name}</td>
            <td><span className="ac-pills">{m.suspended ? <Pill tone="rose">정지</Pill> : m.verified ? <Pill tone="mint">확인됨</Pill> : <Pill tone="sun">미확인</Pill>}{m.isAdmin && <Pill tone="music">관리자</Pill>}</span></td>
            <td title={kst(m.createdAt)}>{kstDay(m.createdAt)}</td>
            <td title={kst(m.lastLoginAt)}>{ago(m.lastLoginAt)}</td>
            <td>{m.hasData ? '있음' : '-'}</td>
          </tr>)}</tbody>
        </table></div>
        {data && !data.members.length && <p className="ac-empty">{q ? `"${q}"에 맞는 회원이 없어요.` : '해당하는 회원이 없어요.'}</p>}
        {data && <Pager page={page} total={data.total} size={size} onPage={setPage} busy={busy} />}
      </>}
    </Panel>
    {open && token && <MemberSheet token={token} id={open} onClose={() => setOpen(null)} onChanged={() => void reload()} />}
  </>;
}

type Pending = { kind: 'suspend' | 'unsuspend' | 'signout' | 'grant' | 'revoke' } | null;

function MemberSheet({ token, id, onClose, onChanged }: { token: string; id: string; onClose: () => void; onChanged: () => void }) {
  const [member, setMember] = useState<Member | null>(null), [error, setError] = useState(''), [pending, setPending] = useState<Pending>(null);
  const [reason, setReason] = useState(''), [password, setPassword] = useState(''), [endSessions, setEndSessions] = useState(false), [notify, setNotify] = useState(true), [busy, setBusy] = useState(false), [news, setNews] = useState('');
  useEffect(() => { let live = true; fetchMember(token, id).then(m => { if (live) setMember(m); }).catch(err => { if (live) setError(errorText(err, '회원 정보')); }); return () => { live = false; }; }, [token, id]);
  const close = useCallback(() => onClose(), [onClose]);
  async function act(e: FormEvent) {
    e.preventDefault();
    if (!member || !pending) return;
    setBusy(true);
    try {
      const role = pending.kind === 'grant' || pending.kind === 'revoke';
      const next = role ? await setMemberAdmin(token, member.id, { grant: pending.kind === 'grant', reason: reason.trim(), password, endSessions: pending.kind === 'revoke' && endSessions })
        : pending.kind === 'suspend' ? await suspendMember(token, member.id, reason.trim(), notify)
        : pending.kind === 'unsuspend' ? await unsuspendMember(token, member.id, reason.trim()) : await signOutMember(token, member.id, reason.trim());
      setMember(next);
      setNews(pending.kind === 'suspend' ? (next.mailed ? '정지했고 안내 메일을 보냈어요.' : notify ? '정지했어요. 안내 메일은 보내지 못했어요. 직접 알려주세요.' : '정지했어요.')
        : pending.kind === 'grant' ? '관리자로 지정했어요. 다시 로그인하면 관리 화면을 쓸 수 있어요.'
        : pending.kind === 'revoke' ? (endSessions ? '관리자 권한을 거두고 모든 기기에서 로그아웃시켰어요.' : '관리자 권한을 거뒀어요.')
        : pending.kind === 'unsuspend' ? '정지를 풀었어요. 다시 로그인하면 쓸 수 있어요.' : '모든 기기에서 로그아웃시켰어요.');
      setPending(null); setReason(''); setPassword(''); setEndSessions(false);
      onChanged();
    } catch (err) {
      // A wrong password is a 401 too: say what the server said, not the console's "sign in as an admin".
      setNews(role && err instanceof ApiError && err.message && !err.message.startsWith('HTTP') ? err.message : errorText(err, '처리 결과')); setPassword('');
    }
    finally { setBusy(false); }
  }
  const role = pending?.kind === 'grant' || pending?.kind === 'revoke';
  const needReason = pending?.kind === 'suspend' || role;
  const cancel = () => { setPending(null); setReason(''); setPassword(''); setEndSessions(false); };
  return <Drawer title={member ? member.email : '회원 정보'} sub={member ? `${member.name} · 가입 ${kst(member.createdAt)}` : undefined} onClose={close}>
    {error ? <Notice><strong>{error}</strong></Notice> : !member ? <p className="ac-empty">불러오는 중…</p> : <>
      <div className="ac-pills big">{member.suspended ? <Pill tone="rose">정지됨</Pill> : <Pill tone="mint">이용 중</Pill>}{member.verified ? <Pill tone="mint">이메일 확인</Pill> : <Pill tone="sun">이메일 미확인</Pill>}{member.isAdmin && <Pill tone="music"><ShieldCheck size={13} /> {member.owner ? '운영자' : '관리자'}</Pill>}</div>
      {member.suspended && <Notice><strong>{kst(member.suspendedAt)}에 정지했어요.</strong><p>이유: {member.suspendedReason}</p></Notice>}
      <p className="sr-only" role="status">{news}</p>
      {news && <p className={`ac-news${news.includes('못') ? ' warn' : ''}`}>{news}</p>}
      <h3 className="ac-sub">계정</h3>
      <Facts rows={[['이메일', <span className="mono">{member.email}</span>], ['가입 이름', member.name], ['가입', kst(member.createdAt)], ['최근 로그인', `${kst(member.lastLoginAt)} (${ago(member.lastLoginAt)})`],
        ['이메일 확인', member.verifiedAt ? kst(member.verifiedAt) : '아직'], ['동의한 약관', member.termsVersion ? `${member.termsVersion} (${kst(member.termsAgreedAt)})` : '기록 없음(2026-11-17 이전 가입)']]} />
      <h3 className="ac-sub">이용</h3>
      <Facts rows={[['오늘 AI 추천', `${num(member.aiToday.used)} / ${num(member.aiToday.limit)}`], ['보낸 오류 신고', `미처리 ${member.reports.open} · 처리 ${member.reports.resolved} · 반려 ${member.reports.dismissed}`],
        ['저장 데이터', member.store.bytes ? `${(member.store.bytes / 1024).toFixed(1)}KB · ${member.store.version}번 저장 · ${ago(member.store.updatedAt)}` : '없음'],
        ...Object.entries(member.store.counts).map(([k, n]) => [COUNT_LABEL[k] || k, `${num(n)}개`] as [string, string])]} />
      <p className="ac-footnote">저장 데이터는 개수만 보여요. 내용(취향, 기록, 메모)은 관리 화면에서 볼 수 없어요.</p>
      <h3 className="ac-sub">조치</h3>
      {!pending ? <div className="ac-actions">
        {member.canSetAdmin && (member.isAdmin
          ? <button type="button" className="button secondary compact" onClick={() => setPending({ kind: 'revoke' })}>관리자 권한 거두기</button>
          : <button type="button" className="button secondary compact" onClick={() => setPending({ kind: 'grant' })} disabled={!member.verified || member.suspended}
              title={!member.verified || member.suspended ? '이메일을 확인했고 정지되지 않은 계정만 지정할 수 있어요' : undefined}>관리자로 지정</button>)}
        {member.isAdmin ? <p className="ac-footnote">{member.owner ? '운영자 계정이에요. 관리자 권한을 넣고 뺄 수 있어요.'
          : member.canSetAdmin ? '관리자 계정은 정지할 수 없어요. 먼저 관리자 권한을 거둬주세요.' : '관리자 계정은 정지할 수 없어요. 권한은 운영자 계정만 바꿀 수 있어요.'}</p>
          : member.suspended ? <button type="button" className="button secondary compact" onClick={() => setPending({ kind: 'unsuspend' })}>정지 풀기</button>
          : <button type="button" className="button danger compact" onClick={() => setPending({ kind: 'suspend' })}>이용 정지</button>}
        {!member.owner && <button type="button" className="button secondary compact" onClick={() => setPending({ kind: 'signout' })}>모든 기기에서 로그아웃</button>}
      </div> : <form className="ac-confirm" onSubmit={act}>
        <strong>{pending.kind === 'grant' ? '이 계정을 관리자로 지정할까요?' : pending.kind === 'revoke' ? '이 계정의 관리자 권한을 거둘까요?'
          : pending.kind === 'suspend' ? '이 계정의 이용을 정지할까요?' : pending.kind === 'unsuspend' ? '정지를 풀까요?' : '모든 기기에서 로그아웃시킬까요?'}</strong>
        <p>{pending.kind === 'grant' ? '관리 화면 전체(회원 정보, 접속 기록, 조치)를 쓸 수 있게 돼요. 지금 로그인된 기기는 로그아웃되고, 다시 로그인하면 권한이 적용돼요.'
          : pending.kind === 'revoke' ? `다음 요청부터 관리 화면을 쓸 수 없어요. ${endSessions ? '로그인된 모든 기기에서도 로그아웃돼요.' : '일반 서비스 로그인은 그대로예요.'}`
          : pending.kind === 'suspend' ? '바로 로그아웃되고, 풀 때까지 로그인과 비밀번호 재설정을 할 수 없어요. 약관에 따라 가입 이메일로 이유를 알려야 해요. 계정 없이 쓰는 기능은 막히지 않아요.'
          : pending.kind === 'unsuspend' ? '다시 로그인할 수 있게 돼요.' : '로그인된 모든 기기에서 로그아웃돼요. 비밀번호를 알면 다시 로그인할 수 있어요.'}</p>
        <label className="ac-field"><span>이유{pending.kind === 'suspend' ? ' (회원에게 보내는 메일에 그대로 들어가요)' : role ? ' (조치 기록에 남아요)' : ' (선택, 조치 기록에만 남아요)'}</span>
          <textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={300} rows={3} required={needReason} minLength={needReason ? 2 : undefined} /></label>
        {role && <label className="ac-field"><span>내 비밀번호 (확인용)</span>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required maxLength={200} /></label>}
        {pending.kind === 'revoke' && <label className="ac-check"><input type="checkbox" checked={endSessions} onChange={e => setEndSessions(e.target.checked)} /> 모든 기기에서 로그아웃도 시키기 (계정이 도용됐을 때)</label>}
        {pending.kind === 'suspend' && <label className="ac-check"><input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} /> 가입 이메일로 정지 안내 보내기</label>}
        <div className="ac-actions">
          <button type="submit" className={`button ${pending.kind === 'suspend' || pending.kind === 'revoke' ? 'danger' : 'primary'} compact`} disabled={busy || (needReason && reason.trim().length < 2) || (role && !password)}>{pending.kind === 'grant' ? '관리자로 지정' : pending.kind === 'revoke' ? '권한 거두기' : pending.kind === 'suspend' ? '정지하기' : pending.kind === 'unsuspend' ? '정지 풀기' : '로그아웃시키기'}</button>
          <button type="button" className="button secondary compact" onClick={cancel}>취소</button>
        </div>
      </form>}
      <h3 className="ac-sub">이 회원에게 한 조치</h3>
      {member.actions.length ? <ol className="ac-timeline">{member.actions.map(a => <li key={a.id}><b>{ACTION_LABEL[a.action] || a.action}</b><span>{kst(a.at)} · {a.actor}</span>{a.reason && <p>{a.reason}</p>}</li>)}</ol> : <p className="ac-empty">아직 없어요.</p>}
    </>}
  </Drawer>;
}
