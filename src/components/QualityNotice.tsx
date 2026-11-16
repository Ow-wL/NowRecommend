import { Info } from 'lucide-react';
import type { Session } from '../domain';

// The server answered, but without the AI or without the sentence's meaning (quota, overload, embedding failure).
export function QualityNotice({ session }: { session: Session }) {
  const quality = session.source === 'server' ? session.quality : undefined;
  if (!quality || (quality.ai !== 'failed' && quality.context && !quality.wanted && !quality.limited)) return null;
  // A daily limit, not a fault: trying again today will not bring the AI back, so the usual "try again" is not offered.
  if (quality.limited) return <div className="notice" role="status"><Info size={18} /><div>
    <strong>{quality.limited === 'service' ? '오늘 준비한 AI 추천이 모두 소진됐어요.' : '오늘 받을 수 있는 AI 추천을 모두 썼어요.'}</strong>
    <p>지금은 저장된 {session.category === 'music' ? '곡 목록' : '메뉴 목록'}에서 골라드려요. 내일 다시 AI가 골라요.{quality.limited === 'guest' && ' 로그인하면 하루에 더 많이 받을 수 있어요.'}</p>
  </div></div>;
  // The AI engine (music) could not answer: the catalog pipeline stood in, which is a different kind of answer.
  if (quality.wanted === 'ai') return <div className="notice" role="status"><Info size={18} /><div>
    <strong>AI 추천을 받지 못해 저장된 {session.category === 'music' ? '곡 목록' : '메뉴 목록'}에서 골랐어요.</strong>
    <p>{quality.ai === 'off' ? '이 서버에는 AI가 설정되지 않았어요.' : 'AI 한도 초과나 응답 지연일 수 있어요. 다른 추천 보기를 누르면 다시 시도해요.'}</p>
  </div></div>;
  return <div className="notice" role="status"><Info size={18} /><div>
    <strong>기본 방식으로 추천했어요.</strong>
    {!quality.context && <p>지금은 문장의 의미를 분석하지 못해 조건 태그와 평소 취향으로 골랐어요.</p>}
    {quality.ai === 'failed' && <p>AI 설명을 받지 못해 기본 설명으로 보여드려요. 다른 추천 보기를 누르면 다시 시도해요.</p>}
  </div></div>;
}
