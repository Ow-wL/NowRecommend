import { useState } from 'react';
import { Check, Search } from 'lucide-react';
import { categoryLabel, type Category, type Item } from '../data';
import type { HistoryEntry, Review } from '../domain';
import { manualEntry } from '../history';
import { ItemArt } from './ItemArt';
import { ratingLabel } from './ReviewForm';

/** Something eaten or listened to without a recommendation, recorded by hand: a catalog item, a feeling and a note. */
export function ManualRecord({ items, category: initial, onSave }: { items: Item[]; category: Category; onSave: (entry: HistoryEntry) => void }) {
  const [category, setCategory] = useState<Category>(initial);
  const [query, setQuery] = useState(''), [pickedId, setPickedId] = useState('');
  const [rating, setRating] = useState<Review['rating']>(), [note, setNote] = useState('');
  const pool = items.filter(i => i.category === category && !i.parentId);
  const matches = (query.trim() ? pool.filter(i => `${i.name} ${i.subtitle}`.toLowerCase().includes(query.trim().toLowerCase())) : pool).slice(0, 8);
  const picked = items.find(i => i.id === pickedId);
  return <div className="manual-record">
    <p className="modal-description">추천 없이 먹거나 들은 것도 남길 수 있어요. 기록과 취향 요약에만 쓰고, 다음 추천과 평소 취향에는 반영하지 않아요.</p>
    <div className="filter-tabs" role="group" aria-label="분야">{(['food', 'music'] as Category[]).map(c => <button key={c} type="button" aria-pressed={category === c} className={category === c ? 'active' : ''} onClick={() => { setCategory(c); setPickedId(''); }}>{categoryLabel[c]}</button>)}</div>
    <label className="search-field"><Search size={16} /><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={category === 'food' ? '메뉴 이름으로 찾기' : '곡이나 아티스트로 찾기'} aria-label="항목 검색" /></label>
    <div className="manual-list" role="group" aria-label="항목 고르기">
      {matches.map(i => <button key={i.id} type="button" className="manual-item" aria-pressed={pickedId === i.id} onClick={() => setPickedId(i.id)}><ItemArt item={i} size="thumb" /><span className="list-copy"><b>{i.name}</b><small>{i.subtitle}</small></span>{pickedId === i.id && <Check size={18} />}</button>)}
      {matches.length === 0 && <p className="small muted">목록에 없는 항목이에요. 지금은 등록된 메뉴와 곡만 기록할 수 있어요.</p>}
    </div>
    <fieldset className="manual-review">
      <legend>느낌 <small>선택 사항</small></legend>
      <div className="chips">{(Object.keys(ratingLabel) as (keyof typeof ratingLabel)[]).map(k => <label key={k} className={`chip ${rating === k ? 'selected' : ''}`}><input type="radio" name="manual-rating" className="sr-only" checked={rating === k} onChange={() => setRating(k)} />{ratingLabel[k]}</label>)}</div>
      <textarea rows={2} maxLength={200} value={note} onChange={e => setNote(e.target.value)} placeholder="메모 (선택, 200자)" aria-label="메모" />
    </fieldset>
    <div className="modal-actions"><button type="button" className="button primary" disabled={!picked} onClick={() => picked && onSave(manualEntry(picked, { rating, note }))}>기록하기</button></div>
  </div>;
}
