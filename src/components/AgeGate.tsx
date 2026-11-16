import { useRef } from 'react';
import { ArrowRight } from 'lucide-react';
import { MIN_AGE } from '../legal';
import { useFocusTrap } from './Modal';

/** Asked once per browser before the AI is used, signed in or not: the AI provider's terms allow the service only for
 * people of MIN_AGE and over. It cannot be dismissed without an answer; the documents open in another tab. */
export function AgeGate({ onConfirm }: { onConfirm: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, () => { /* no way out but an answer */ });
  return <div className="modal-backdrop neutral-scope"><div className="modal age-gate" ref={ref} role="dialog" aria-modal="true" aria-labelledby="age-gate-title">
    <h2 id="age-gate-title">만 {MIN_AGE}세 이상이신가요?</h2>
    <p className="modal-description">지금 추천은 AI로 메뉴와 음악을 골라드려요. AI 서비스의 이용 조건에 따라 만 {MIN_AGE}세 이상만 이용할 수 있어요.</p>
    <button data-safe-focus className="button primary full-width" onClick={onConfirm}>만 {MIN_AGE}세 이상이에요 <ArrowRight size={16} /></button>
    <p className="small muted age-gate-note">만 {MIN_AGE}세 미만이라면 이용할 수 없어요. 이 창을 닫아주세요.</p>
    <p className="age-gate-links"><a href="#/terms" target="_blank" rel="noopener">이용약관</a><a href="#/privacy" target="_blank" rel="noopener">개인정보 처리방침</a></p>
  </div></div>;
}
