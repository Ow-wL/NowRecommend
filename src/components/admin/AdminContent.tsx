import { useEffect, useState, type FormEvent } from 'react';
import { Search } from 'lucide-react';
import { ACTION_LABEL, fetchItem, hideItem, searchItems, showItem, type ItemDetails, type ItemStatusFilter } from '../../api/admin';
import { kindLabel, type ReportKind } from '../../api/reports';
import { Drawer, Facts, Notice, Pager, Panel, Pill, Segmented, errorText, kst, kstDay, num, useLoad } from './common';

// 콘텐츠 (admin console, 2026-11-26): the menus and songs in the database, and taking one out of recommendations.
const STATUS: [ItemStatusFilter, string][] = [['reviewed', '공개'], ['draft', 'AI 후보'], ['hidden', '숨김'], ['rejected', '내림'], ['all', '전체']];
const CATEGORY: [('all' | 'food' | 'music'), string][] = [['all', '전체'], ['food', '음식'], ['music', '음악']];
const SOURCE: Record<string, string> = { seed: '기본 목록', ai_draft: 'AI가 고름', user_request: '요청' };
const STATUS_PILL = (status: string, hidden: boolean) => hidden ? <Pill tone="rose">숨김</Pill> : status === 'reviewed' ? <Pill tone="mint">공개</Pill> : status === 'draft' ? <Pill tone="sun">AI 후보</Pill> : <Pill tone="ink">내림</Pill>;

export function AdminContent({ token, stamp }: { token?: string; stamp: number }) {
  const [draft, setDraft] = useState(''), [q, setQ] = useState(''), [category, setCategory] = useState<'all' | 'food' | 'music'>('all');
  const [status, setStatus] = useState<ItemStatusFilter>('reviewed'), [page, setPage] = useState(1), [open, setOpen] = useState<string | null>(null);
  const size = 30;
  const { data, error, busy, reload } = useLoad(token ? () => searchItems(token, { q, category, status, source: 'all', page, size }) : null, `${q}|${category}|${status}|${page}|${stamp}`, '항목 목록');
  const submit = (e: FormEvent) => { e.preventDefault(); setPage(1); setQ(draft.trim()); };
  const counts = data?.counts;
  return <>
    <Panel title="메뉴와 곡" sub="추천에 쓰는 항목이에요. 문제가 있는 항목은 숨겨 새 추천에서 뺄 수 있어요."
      actions={<form className="ac-search" onSubmit={submit} role="search"><Search size={16} aria-hidden="true" /><label className="sr-only" htmlFor="item-q">이름이나 가수로 찾기</label>
        <input id="item-q" type="search" placeholder="이름·가수·ID로 찾기" value={draft} onChange={e => setDraft(e.target.value)} autoComplete="off" /><button type="submit" className="button secondary compact">찾기</button></form>}>
      <div className="ac-toolbar">
        <Segmented label="분야" value={category} options={CATEGORY} onChange={v => { setCategory(v); setPage(1); }} />
        <Segmented label="상태" value={status} options={STATUS.map(([v, l]) => [v, counts && v !== 'all' && counts[v] !== undefined ? `${l} ${num(counts[v])}` : l])} onChange={v => { setStatus(v); setPage(1); }} />
      </div>
      {error ? <Notice><strong>{error}</strong></Notice> : <>
        <div className="ac-table-wrap"><table className="ac-table">
          <thead><tr><th scope="col">항목</th><th scope="col">분야</th><th scope="col">상태</th><th scope="col">출처</th><th scope="col">특징</th><th scope="col">미처리 신고</th><th scope="col">바뀐 때</th></tr></thead>
          <tbody>{data?.items.map(i => <tr key={i.id}>
            <td><button type="button" className="ac-link ac-item" onClick={() => setOpen(i.id)}><span className="ac-emoji" style={{ background: i.color }} aria-hidden="true">{i.emoji}</span><span><b>{i.name}</b><small>{i.artist || i.subtitle}</small></span></button></td>
            <td>{i.category === 'food' ? <Pill tone="food">음식</Pill> : <Pill tone="music">음악</Pill>}</td>
            <td>{STATUS_PILL(i.status, !!i.hiddenAt)}</td>
            <td>{SOURCE[i.source] || i.source}</td>
            <td className="ac-wrap small">{i.tags.slice(0, 4).join(', ')}{i.tags.length > 4 ? ` 외 ${i.tags.length - 4}` : ''}</td>
            <td>{i.openReports ? <Pill tone="rose">{i.openReports}</Pill> : '-'}</td>
            <td>{kstDay(i.updatedAt)}</td>
          </tr>)}</tbody>
        </table></div>
        {data && !data.items.length && <p className="ac-empty">해당하는 항목이 없어요.</p>}
        {data && <Pager page={page} total={data.total} size={size} onPage={setPage} busy={busy} />}
      </>}
    </Panel>
    {open && token && <ItemSheet token={token} id={open} onClose={() => setOpen(null)} onChanged={() => void reload()} />}
  </>;
}

function ItemSheet({ token, id, onClose, onChanged }: { token: string; id: string; onClose: () => void; onChanged: () => void }) {
  const [item, setItem] = useState<ItemDetails | null>(null), [error, setError] = useState(''), [asking, setAsking] = useState(false);
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [news, setNews] = useState('');
  useEffect(() => { let live = true; fetchItem(token, id).then(i => { if (live) setItem(i); }).catch(err => { if (live) setError(errorText(err, '항목')); }); return () => { live = false; }; }, [token, id]);
  async function act(e: FormEvent) {
    e.preventDefault();
    if (!item) return;
    setBusy(true);
    try {
      const next = item.hiddenAt ? await showItem(token, item.id, reason.trim()) : await hideItem(token, item.id, reason.trim());
      setItem(next); setAsking(false); setReason(''); setNews(next.hiddenAt ? '숨겼어요. 새 추천에 나오지 않아요.' : '숨김을 풀었어요.'); onChanged();
    } catch (err) { setNews(errorText(err, '처리 결과')); }
    finally { setBusy(false); }
  }
  return <Drawer title={item ? item.name : '항목'} sub={item ? `${item.artist || item.subtitle} · ${item.id}` : undefined} onClose={onClose}>
    {error ? <Notice><strong>{error}</strong></Notice> : !item ? <p className="ac-empty">불러오는 중…</p> : <>
      <div className="ac-pills big">{STATUS_PILL(item.status, !!item.hiddenAt)}{item.category === 'food' ? <Pill tone="food">음식</Pill> : <Pill tone="music">음악</Pill>}<Pill tone="ink">{SOURCE[item.source] || item.source}</Pill></div>
      {news && <p className="ac-news" role="status">{news}</p>}
      <p className="ac-desc">{item.description}</p>
      <Facts rows={[['특징', item.tags.join(', ') || '-'], ...(item.category === 'food' ? [['재료', item.ingredients.join(', ') || '-'] as [string, string]] : [['발매', item.releaseYear ? `${item.releaseYear}년` : '-'] as [string, string]]),
        ['최근 30일 추천에 나온 횟수', `${num(item.shown30d)}번`], ['처음 들어온 때', kst(item.createdAt)], ['검수', item.reviewedAt ? kst(item.reviewedAt) : '-'], ...(item.parentId ? [['참고 사진', item.parentId] as [string, string]] : []),
        ...(item.hiddenAt ? [['숨긴 때', kst(item.hiddenAt)] as [string, string]] : [])]} />
      {item.reviewNotes.length > 0 && <><h3 className="ac-sub">검수 메모</h3><ul className="ac-bullets">{item.reviewNotes.map((n, k) => <li key={k}>{n}</li>)}</ul></>}
      <h3 className="ac-sub">조치</h3>
      {!asking ? <div className="ac-actions">
        <button type="button" className={`button ${item.hiddenAt ? 'secondary' : 'danger'} compact`} onClick={() => setAsking(true)}>{item.hiddenAt ? '숨김 풀기' : '추천에서 숨기기'}</button>
      </div> : <form className="ac-confirm" onSubmit={act}>
        <strong>{item.hiddenAt ? '숨김을 풀까요?' : '이 항목을 추천에서 숨길까요?'}</strong>
        <p>{item.hiddenAt ? '다시 새 추천과 목록에 나올 수 있어요(공개 상태인 경우).' : '새 추천과 공개 목록에서 빠지고, AI에게도 피하라고 알려요. 이미 즐겨찾기나 기록에 있는 것은 그대로예요. 기본 목록을 다시 넣어도 숨김은 유지돼요.'}</p>
        <label className="ac-field"><span>이유{item.hiddenAt ? ' (선택)' : ''}</span><textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={300} rows={2} required={!item.hiddenAt} minLength={item.hiddenAt ? undefined : 2} /></label>
        <div className="ac-actions"><button type="submit" className={`button ${item.hiddenAt ? 'primary' : 'danger'} compact`} disabled={busy || (!item.hiddenAt && reason.trim().length < 2)}>{item.hiddenAt ? '숨김 풀기' : '숨기기'}</button>
          <button type="button" className="button secondary compact" onClick={() => setAsking(false)}>취소</button></div>
      </form>}
      <h3 className="ac-sub">이 항목의 오류 신고</h3>
      {item.reports.length ? <ol className="ac-timeline">{item.reports.map(r => <li key={r.id}><b>{kindLabel(r.kind as ReportKind, item.category)}</b><span>{kst(r.at)} · {r.status === 'open' ? '미처리' : r.status === 'resolved' ? '처리 완료' : '반려'}</span>{r.note && <p>{r.note}</p>}</li>)}</ol> : <p className="ac-empty">신고가 없어요.</p>}
      <h3 className="ac-sub">조치 기록</h3>
      {item.actions.length ? <ol className="ac-timeline">{item.actions.map(a => <li key={a.id}><b>{ACTION_LABEL[a.action] || a.action}</b><span>{kst(a.at)} · {a.actor}</span>{a.reason && <p>{a.reason}</p>}</li>)}</ol> : <p className="ac-empty">아직 없어요.</p>}
    </>}
  </Drawer>;
}
