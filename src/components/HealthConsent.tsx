import { ArrowRight } from 'lucide-react';
import { Modal } from './Modal';

/** Asked when what was typed has words about health in it, before it is stored or sent (src/sensitive.ts). The law wants
 * this consent on its own, with what is handled, why, for how long, and that saying no is allowed and what follows
 * (개인정보 보호법 제23조 제1항 제1호, 제15조 제2항). Closing the dialog is saying no. */
export function HealthConsent({ terms, onAgree, onDecline }: { terms: string[]; onAgree: () => void; onDecline: () => void }) {
  return <Modal neutral over title="건강과 관련된 내용을 적으셨어요" onClose={onDecline}>
    <p className="modal-description">입력한 글에 건강과 관련된 표현({terms.slice(0, 3).map(term => `“${term}”`).join(', ')})이 있어요. 건강에 관한 정보는 법이 정한 민감정보라서, 저장하거나 보내기 전에 따로 동의를 받아요.</p>
    <ul className="consent-facts">
      <li><b>처리하는 정보</b> 입력란에 적은 건강 관련 내용</li>
      <li><b>쓰는 목적</b> 그 내용을 반영한 추천</li>
      <li><b>보내는 곳</b> 추천을 만들 때 AI 서비스(Google, 미국 등)로 보내요. Google은 오용을 막으려고 55일 동안 보관해요.</li>
      <li><b>보관 기간</b> 추천 기록과 취향에 남아요. 로그인했다면 계정에도 저장돼요. 직접 지우거나 계정을 삭제할 때까지 보관해요.</li>
      <li><b>동의하지 않아도 돼요</b> 그러면 이 글은 저장하거나 보내지 않아요. “땅콩 제외”처럼 건강 이야기 없이 재료 이름만 적으면 그대로 쓸 수 있어요.</li>
    </ul>
    <p className="small muted">한 번 동의하면 이 브라우저에서는 다시 묻지 않아요. 설정 &gt; 데이터 관리에서 언제든 철회할 수 있어요. <a href="#/privacy" target="_blank" rel="noopener">개인정보 처리방침</a></p>
    <div className="modal-actions"><button data-safe-focus className="button secondary" onClick={onDecline}>고쳐 쓸게요</button><button className="button primary" onClick={onAgree}>동의하고 계속 <ArrowRight size={16} /></button></div>
  </Modal>;
}
