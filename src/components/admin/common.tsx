import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { ApiError } from '../../api/client';

// Pieces the admin console's sections share (2026-11-26): loading with a stale-answer guard, numbers, cards, pills, a pager
// and the side sheet that opens one member or item.

export const errorText = (err: unknown, what: string) =>
  err instanceof ApiError && (err.status === 401 || err.status === 403) ? '관리자 계정으로 로그인해야 볼 수 있어요.' : err instanceof ApiError && err.message && !err.message.startsWith('HTTP') && err.status ? err.message : `${what}${object(what)} 불러오지 못했어요.`;
/** 을 or 를, by whether the word ends in a final consonant. */
export const object = (word: string) => { const c = word.charCodeAt(word.length - 1) - 0xAC00; return c >= 0 && c < 11172 && c % 28 ? '을' : '를'; };

/** Loads with `fetcher` whenever `key` changes; an answer to an older ask is dropped. */
export function useLoad<T>(fetcher: (() => Promise<T>) | null, key: string, what: string) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [at, setAt] = useState<Date | null>(null);
  const asked = useRef(0), latest = useRef(fetcher);
  latest.current = fetcher;
  const reload = useCallback(async () => {
    const run = latest.current;
    if (!run) { setError('관리자 계정으로 로그인해야 볼 수 있어요.'); return; }
    const mine = ++asked.current;
    setBusy(true);
    try { const next = await run(); if (mine === asked.current) { setData(next); setError(''); setAt(new Date()); } }
    catch (err) { if (mine === asked.current) setError(errorText(err, what)); }
    finally { if (mine === asked.current) setBusy(false); }
  }, [what]);
  useEffect(() => { void reload(); }, [key, reload]);
  return { data, error, busy, reload, at, setData };
}

const KST = { timeZone: 'Asia/Seoul' } as const;
export const kst = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString('ko-KR', { ...KST, year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
export const kstDate = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleDateString('ko-KR', { ...KST, year: 'numeric', month: 'short', day: 'numeric' }) : '-';
/** 2026.11.26 (KST). */
export const kstDay = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleDateString('sv-SE', KST).replaceAll('-', '.') : '-';
export const ago = (iso: string | null | undefined, now = Date.now()) => {
  if (!iso) return '없음';
  const minutes = Math.round((now - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return minutes < -5 ? kstDate(iso) : '방금';
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}시간 전`;
  if (minutes < 60 * 24 * 60) return `${Math.round(minutes / 60 / 24)}일 전`;
  return kstDate(iso);
};
export const num = (n: number | null | undefined) => n === null || n === undefined ? '-' : n.toLocaleString('ko-KR');
export const ms = (v: number | null | undefined) => v === null || v === undefined ? '-' : v >= 1000 ? `${(v / 1000).toFixed(1)}초` : `${v}ms`;
export const percent = (a: number, b: number) => b ? `${Math.round(a / b * 100)}%` : '-';
export const short = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;

export type Tone = 'food' | 'music' | 'sun' | 'mint' | 'rose' | 'ink';

/** A change against the period before: up or down and by how much (no colour judgement for counts that are neither good nor bad). */
export function Delta({ current, previous, goodWhenUp = true }: { current: number; previous: number; goodWhenUp?: boolean | null }) {
  if (!previous && !current) return <span className="ac-delta flat">변화 없음</span>;
  if (!previous) return <span className="ac-delta up good">새로 생김</span>;
  const change = Math.round((current - previous) / previous * 100);
  if (change === 0) return <span className="ac-delta flat">지난 기간과 같음</span>;
  const up = change > 0, tone = goodWhenUp === null ? '' : up === goodWhenUp ? ' good' : ' bad';
  return <span className={`ac-delta ${up ? 'up' : 'down'}${tone}`} aria-label={`지난 기간보다 ${Math.abs(change)}% ${up ? '늘었어요' : '줄었어요'}`}>{up ? '▲' : '▼'} {Math.abs(change)}%</span>;
}

/** A small line of a series, scaled to its own range; the last point is marked. */
export function Sparkline({ values, tone = 'ink' }: { values: number[]; tone?: Tone }) {
  if (values.length < 2) return null;
  const w = 120, h = 32, max = Math.max(1, ...values), step = w / (values.length - 1);
  const points = values.map((v, n) => `${(n * step).toFixed(1)},${(h - 3 - (v / max) * (h - 6)).toFixed(1)}`);
  const last = points[points.length - 1].split(',');
  return <svg className={`ac-spark tone-${tone}`} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" preserveAspectRatio="none">
    <polyline points={`0,${h} ${points.join(' ')} ${w},${h}`} className="area" />
    <polyline points={points.join(' ')} className="line" />
    <circle cx={last[0]} cy={last[1]} r="2.6" className="dot" />
  </svg>;
}

export function KpiCard({ label, value, hint, tone = 'ink', icon, spark, delta, onClick }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; icon?: ReactNode;
  spark?: number[]; delta?: ReactNode; onClick?: () => void }) {
  const body = <>
    <div className="ac-kpi-head"><span className={`ac-kpi-icon tone-${tone}`} aria-hidden="true">{icon}</span><small>{label}</small></div>
    <b className="ac-kpi-value">{value}</b>
    <div className="ac-kpi-foot">{delta}{hint && <span className="ac-kpi-hint">{hint}</span>}</div>
    {spark && <Sparkline values={spark} tone={tone} />}
  </>;
  return onClick ? <button type="button" className="ac-card ac-kpi clickable" onClick={onClick}>{body}</button> : <div className="ac-card ac-kpi">{body}</div>;
}

export const Pill = ({ tone = 'ink', children }: { tone?: Tone; children: ReactNode }) => <span className={`ac-pill tone-${tone}`}>{children}</span>;

export function Panel({ title, sub, actions, children, className = '' }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`ac-card ac-panel ${className}`}>
    <header className="ac-panel-head"><div><h3>{title}</h3>{sub && <p>{sub}</p>}</div>{actions && <div className="ac-panel-actions">{actions}</div>}</header>
    {children}
  </section>;
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return <div className="ac-segment" role="group" aria-label={label}>{options.map(([v, text]) => <button key={String(v)} type="button" aria-pressed={value === v} className={value === v ? 'active' : ''} onClick={() => onChange(v)}>{text}</button>)}</div>;
}

export function Pager({ page, total, size, onPage, busy }: { page: number; total: number; size: number; onPage: (p: number) => void; busy?: boolean }) {
  const pages = Math.max(1, Math.ceil(total / size)), from = total ? (page - 1) * size + 1 : 0, to = Math.min(total, page * size);
  return <nav className="ac-pager" aria-label="페이지">
    <span>{num(total)}개 중 {num(from)}–{num(to)}</span>
    <button type="button" className="icon-button" aria-label="이전 페이지" disabled={busy || page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={18} /></button>
    <b aria-current="page">{page} / {pages}</b>
    <button type="button" className="icon-button" aria-label="다음 페이지" disabled={busy || page >= pages} onClick={() => onPage(page + 1)}><ChevronRight size={18} /></button>
  </nav>;
}

/** A sheet from the right with one member or item; Escape and the backdrop close it, focus starts on its heading. */
export function Drawer({ title, sub, onClose, children }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    heading.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); before?.focus?.(); };
  }, [onClose]);
  return <div className="ac-drawer-layer">
    <div className="ac-drawer-backdrop" onClick={onClose} aria-hidden="true" />
    <aside className="ac-drawer" role="dialog" aria-modal="true" aria-labelledby="ac-drawer-title">
      <header><div><h2 id="ac-drawer-title" ref={heading} tabIndex={-1}>{title}</h2>{sub && <p>{sub}</p>}</div>
        <button type="button" className="icon-button" aria-label="닫기" onClick={onClose}><X size={20} /></button></header>
      <div className="ac-drawer-body">{children}</div>
    </aside>
  </div>;
}

export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="ac-facts">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

export function Notice({ children, tone = 'warning' }: { children: ReactNode; tone?: 'warning' | 'info' }) {
  return <div className={`notice ${tone === 'warning' ? 'warning' : ''}`} role={tone === 'warning' ? 'alert' : 'status'}><div>{children}</div></div>;
}

export function Meter({ used, limit, label }: { used: number; limit: number; label: string }) {
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0, tone = ratio >= .9 ? 'rose' : ratio >= .6 ? 'sun' : 'mint';
  return <div className="ac-meter">
    <div className="ac-meter-head"><span>{label}</span><b>{num(used)}<small> / {limit > 0 ? num(limit) : '한도 없음'}</small></b></div>
    <i role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={limit || 1} aria-valuenow={used}><u className={`tone-${tone}`} style={{ width: `${ratio * 100}%` }} /></i>
  </div>;
}
