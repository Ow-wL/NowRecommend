import { Info } from 'lucide-react';
import type { Session } from '../domain';

// The server answered, but without the AI or without the sentence's meaning (quota, overload, embedding failure).
export function QualityNotice({ session }: { session: Session }) {
  const quality = session.source === 'server' ? session.quality : undefined;
  if (!quality || (quality.ai !== 'failed' && quality.context && !quality.wanted)) return null;
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
