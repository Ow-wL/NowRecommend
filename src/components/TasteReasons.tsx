import { ChevronDown, X } from 'lucide-react';
import type { Category, Item } from '../data';
import type { CustomTaste } from '../domain';
import { ItemArt } from './ItemArt';

export const REASON_LIMIT = 60;
const SUGGESTIONS: Record<Category, string[]> = {
  food: ['매콤해서', '담백해서', '바삭해서', '국물이 좋아서', '든든해서', '간편해서', '추억이 있어서'],
  music: ['멜로디가 좋아서', '가사가 좋아서', '목소리가 좋아서', '분위기가 좋아서', '신나서', '차분해서', '추억이 있어서'],
};
// One reason per liked item, written or picked. Optional: it only gives the AI more to go on.
function ReasonRow({ category, label, art, value, onChange, onRemove }: { category: Category; label: string; art?: Item; value: string; onChange: (text: string) => void; onRemove?: () => void }) {
  const parts = value.split(', ').filter(Boolean);
  return <li className="reason-row">
    <div className="reason-head">{art && <ItemArt item={art} size="thumb" />}<b>{label}</b>{onRemove && <button className="icon-button" aria-label={`${label} 직접 추가 삭제`} onClick={onRemove}><X size={15} /></button>}</div>
    <input aria-label={`${label}을 좋아하는 이유`} maxLength={REASON_LIMIT} placeholder="좋아하는 이유 (선택)" value={value} onChange={e => onChange(e.target.value)} />
    <div className="reason-chips" role="group" aria-label={`${label} 이유 고르기`}>{SUGGESTIONS[category].map(s => { const on = parts.includes(s); return <button key={s} className={`chip small ${on ? 'selected' : ''}`} aria-pressed={on} onClick={() => onChange((on ? parts.filter(p => p !== s) : [...parts, s]).join(', ').slice(0, REASON_LIMIT))}>{s}</button>; })}</div>
  </li>;
}

export function TasteReasons({ category, items, custom, reasons, onReason, onCustom }: {
  category: Category; items: Item[]; custom: CustomTaste[]; reasons: Record<string, string>;
  onReason: (id: string, text: string) => void; onCustom: (next: CustomTaste[]) => void;
}) {
  if (!items.length && !custom.length) return null;
  const written = items.filter(i => reasons[i.id]?.trim()).length + custom.filter(c => c.reason?.trim()).length;
  return <details className="panel reason-panel" open>
    <summary>왜 좋아하세요? <small>{written}/{items.length + custom.length}개 작성 · 선택 사항</small><ChevronDown size={16} className="chevron" /></summary>
    <p className="muted small">이유를 적으면 AI가 비슷한 이유로 좋아할 만한 {category === 'food' ? '메뉴' : '곡'}를 골라요.</p>
    <ul className="reason-list">
      {items.map(i => <ReasonRow key={i.id} category={category} label={i.name} art={i} value={reasons[i.id] || ''} onChange={text => onReason(i.id, text)} />)}
      {custom.map(c => <ReasonRow key={c.id} category={category} label={c.name} value={c.reason || ''} onChange={reason => onCustom(custom.map(o => o.id === c.id ? { ...o, reason } : o))} onRemove={() => onCustom(custom.filter(o => o.id !== c.id))} />)}
    </ul>
  </details>;
}
