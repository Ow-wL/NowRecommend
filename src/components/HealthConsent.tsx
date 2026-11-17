import { ArrowRight } from 'lucide-react';
import { Modal } from './Modal';

/** Asked when what was typed has words about health in it, before it is kept or sent (src/sensitive.ts). The law wants
 * this consent on its own, with what is handled, why, where it goes, for how long, and that saying no is allowed and
 * what follows (개인정보 보호법 제23조 제1항 제1호, 제15조 제2항).
 *
 * Two occasions. While typing: closing the dialog is saying no, and the words stay in their field, unsaved and unsent.
 * `existing`: the store already holds such words without a consent (records from before this was asked, a backup): the
 * person agrees or has those texts removed, and there is no closing it without one of the two. */
export function HealthConsent({ terms, existing = false, onAgree, onDecline }: { terms: string[]; existing?: boolean; onAgree: () => void; onDecline: () => void }) {
  const words = terms.slice(0, 3).map(term => `“${term}”`).join(', ');
  return <Modal neutral over required={existing} title={existing ? '저장된 기록에 건강과 관련된 내용이 있어요' : '건강과 관련된 내용을 적으셨어요'} onClose={existing ? () => { /* an answer is needed */ } : onDecline}>
    <p className="modal-description">{existing
      ? <>남아 있는 기록이나 취향에 건강과 관련된 표현({words})이 있어요. 건강에 관한 정보는 법이 정한 민감정보라서, 계속 보관하고 쓰려면 따로 동의가 필요해요.</>
      : <>입력한 글에 건강과 관련된 표현({words})이 있어요. 건강에 관한 정보는 법이 정한 민감정보라서, 기록에 남기거나 보내기 전에 따로 동의를 받아요.</>}</p>
    <ul className="consent-facts">
      <li><b>처리하는 정보</b> 입력란에 적은 건강 관련 내용</li>
      <li><b>쓰는 목적</b> 그 내용을 반영한 추천, 기록과 메모의 보관. 오류 신고에 적었다면 신고 내용의 확인</li>
      <li><b>보내는 곳</b> 상황 문장과 취향에 적은 이유는 추천을 만들 때 AI 서비스(Google, 미국 등)로 보내요. Google은 오용을 막으려고 55일 동안 보관해요. 기록의 메모와 신고 내용은 AI로 보내지 않아요.</li>
      <li><b>보관 기간</b> 추천 기록과 취향은 직접 지우거나 계정을 삭제할 때까지 보관해요. 로그인했다면 계정에도 저장돼요. 신고 내용은 서비스를 운영하는 동안 보관해요.</li>
      <li><b>동의하지 않아도 돼요</b> {existing
        ? '그러면 건강 관련 표현이 든 문장과 메모만 지워요. 추천 결과, 선택, 평가는 그대로 남아요.'
        : '그러면 이 글은 기록에 남기거나 서버로 보내지 않아요. “땅콩 제외”처럼 건강 이야기 없이 재료 이름만 적으면 그대로 쓸 수 있어요.'}</li>
    </ul>
    <p className="small muted">한 번 동의하면 다시 묻지 않아요. 설정 &gt; 데이터 관리에서 언제든 철회할 수 있고, 철회하면 건강 관련 표현이 든 글을 지워요. <a href="#/privacy" target="_blank" rel="noopener">개인정보 처리방침</a></p>
    <div className="modal-actions"><button data-safe-focus className="button secondary" onClick={onDecline}>{existing ? '그 글만 지울게요' : '고쳐 쓸게요'}</button><button className="button primary" onClick={onAgree}>{existing ? '동의하고 그대로 두기' : '동의하고 계속'} <ArrowRight size={16} /></button></div>
  </Modal>;
}
