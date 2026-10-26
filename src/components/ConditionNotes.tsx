import { AlertTriangle, Ban } from 'lucide-react';
import type { Category } from '../data';
import { exclusionNotes, unsupportedConditions, unsupportedNote, type Conditions, type Unsupported } from '../domain';

// What the sentence asked for that is checked only in part or not at all, shown before recommending (and folded on the
// results). Unsupported phrases are never turned into other conditions; they are only named here.
export function ConditionNotes({ raw, category, conditions, folded = false }: { raw: string; category: Category; conditions: Conditions; folded?: boolean }) {
  const unsupported = unsupportedConditions(raw, category);
  const { partial, ingredients } = exclusionNotes(conditions);
  if (!unsupported.length && !partial.length && !ingredients) return null;
  const kinds = [...new Set(unsupported.map(u => u.kind))];
  const quoted = (kind: Unsupported['kind']) => unsupported.filter(u => u.kind === kind).map(u => `‘${u.text}’`).join(', ');
  const body = <>
    {partial.length > 0 && <div className="condition-note partial"><AlertTriangle size={17} aria-hidden="true" /><div><strong>일부만 확인할 수 있는 조건</strong>{partial.map(p => <p key={p}>{p}</p>)}</div></div>}
    {kinds.length > 0 && <div className="condition-note unsupported"><Ban size={17} aria-hidden="true" /><div><strong>지원하지 않는 조건</strong><ul>{kinds.map(k => <li key={k}><b>{quoted(k)}</b> {unsupportedNote[k]}</li>)}</ul></div></div>}
    {ingredients && <p className="condition-caveat">재료 제외는 등록된 재료 기준이에요. 실제 판매처의 재료나 알레르기 안전은 보장하지 않아요.</p>}
  </>;
  if (!folded) return <div className="condition-notes" role="status">{body}</div>;
  const summary = [kinds.length ? `지원하지 않는 조건 ${unsupported.length}개` : '', partial.length ? `일부만 확인 ${partial.length}개` : ''].filter(Boolean).join(' · ') || '재료 제외 안내';
  return <details className="condition-notes folded"><summary>{summary}</summary>{body}</details>;
}
