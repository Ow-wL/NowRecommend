import { useState } from 'react';
import { ApiError } from '../api/client';
import { FEEDBACK_LIMIT, appVersion, feedbackKinds, screenName, sendFeedback, type FeedbackKind } from '../api/feedback';
import { healthTerms } from '../sensitive';
import { Modal } from './Modal';

// 의견 보내기 (2026-11-18). Sent without the account; an answer comes back only to an address the person writes here.
// Words about health are not taken in (they would need a consent of their own): the form asks to say it another way.
export function FeedbackDialog({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const [kind, setKind] = useState<FeedbackKind>('problem'), [message, setMessage] = useState(''), [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const ready = !busy && !!message.trim();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    const health = healthTerms(message);
    if (health.length) { setError(`건강과 관련된 표현(${health.slice(0, 3).join(', ')})은 의견에 적을 수 없어요. 기능 이름으로 설명해주세요. 예: "제외 조건이 적용되지 않아요"`); return; }
    setBusy(true); setError('');
    try {
      await sendFeedback({ kind, message: message.trim(), contact: contact.trim(), page: screenName(window.location.hash), appVersion: appVersion() });
      onSent();
    } catch (err) {
      setBusy(false);
      setError(err instanceof ApiError && err.status === 429 ? err.message || '오늘은 의견을 더 보낼 수 없어요. 내일 다시 보내주세요.'
        : err instanceof ApiError && err.status === 422 ? '답장 받을 이메일 형식과 내용을 확인해주세요.' : '의견을 보내지 못했어요. 잠시 후 다시 시도해주세요.');
    }
  }
  return <Modal title="의견 보내기" onClose={onClose}>
    <p className="modal-description">불편한 점, 바라는 기능, 좋았던 점 무엇이든 들려주세요. 운영자가 직접 읽어요.</p>
    <form className="report-form" onSubmit={submit}>
      <fieldset><legend className="sr-only">의견 종류</legend>
        {feedbackKinds.map(([k, label]) => <label key={k} className="report-kind"><input type="radio" name="feedback-kind" checked={kind === k} onChange={() => setKind(k)} />{label}</label>)}
      </fieldset>
      <label className="field-title" htmlFor="feedback-message">내용 <small>{message.length}/{FEEDBACK_LIMIT}</small></label>
      <textarea id="feedback-message" rows={5} required maxLength={FEEDBACK_LIMIT} value={message} onChange={e => setMessage(e.target.value)} placeholder="예: 음악 추천에서 같은 가수가 너무 자주 나와요" />
      <label className="field-title" htmlFor="feedback-contact">답장 받을 이메일 <small>선택</small></label>
      <input id="feedback-contact" type="email" autoComplete="email" inputMode="email" maxLength={254} value={contact} onChange={e => setContact(e.target.value)} placeholder="답장이 필요할 때만 적어주세요" />
      <p className="small muted">보내는 것: 고른 종류, 내용, 적은 경우 이메일, 보던 화면 이름과 앱 버전. 계정과 연결하지 않아요. 답장과 서비스 개선에만 쓰고 1년 뒤 지워요. 건강 상태나 다른 사람의 개인정보는 적지 말아주세요.</p>
      {error && <div className="error-box" role="alert">{error}</div>}
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>취소</button><button className="button primary" disabled={!ready}>{busy && <span className="spinner" />}보내기</button></div>
    </form>
  </Modal>;
}
