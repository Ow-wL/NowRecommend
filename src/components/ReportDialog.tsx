import { useState } from 'react';
import type { Item } from '../data';
import { kindLabel, reportKinds, sendReport, type ReportKind } from '../api/reports';
import { ApiError } from '../api/client';
import { Modal } from './Modal';

const NOTE_LIMIT = 300;
// The toast does not show over a dialog, so a failure is told here. "기타" needs a word, or there is nothing to act on.
export function ReportDialog({ item, token, onClose, onSent }: { item: Item; token?: string; onClose: () => void; onSent: () => void }) {
  const [kind, setKind] = useState<ReportKind>('wrong_image'), [note, setNote] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const ready = !busy && (kind !== 'other' || !!note.trim());
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true); setError('');
    try { await sendReport({ itemId: item.id, kind, note: note.trim() }, token); onSent(); }
    catch (err) { setBusy(false); setError(err instanceof ApiError && err.status === 429 ? '신고가 너무 많아요. 잠시 후 다시 보내주세요.' : '신고를 보내지 못했어요. 잠시 후 다시 시도해주세요.'); }
  }
  return <Modal title="오류 신고" onClose={onClose}>
    <p className="modal-description"><b>{item.name}</b>에서 무엇이 잘못됐나요?</p>
    <form className="report-form" onSubmit={submit}>
      <fieldset><legend className="sr-only">오류 종류</legend>
        {reportKinds.map(k => <label key={k} className="report-kind"><input type="radio" name="report-kind" checked={kind === k} onChange={() => setKind(k)} />{kindLabel(k, item.category)}</label>)}
      </fieldset>
      <label className="field-title" htmlFor="report-note">자세한 내용 {kind !== 'other' && <small>선택</small>}</label>
      <textarea id="report-note" rows={3} maxLength={NOTE_LIMIT} value={note} onChange={e => setNote(e.target.value)} placeholder={item.category === 'food' ? '예: 빙수인데 다른 음식 아이콘이 나와요' : '예: 다른 가수의 곡으로 연결돼요'} />
      {error && <div className="error-box" role="alert">{error}</div>}
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>취소</button><button className="button primary" disabled={!ready}>{busy && <span className="spinner" />}신고 보내기</button></div>
    </form>
  </Modal>;
}
