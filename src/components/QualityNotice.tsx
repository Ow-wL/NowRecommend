import { Info } from 'lucide-react';
import type { Session } from '../domain';

// The server answered, but without the AI or without the sentence's meaning (quota, overload, embedding failure).
export function QualityNotice({ session }: { session: Session }) {
  const quality = session.source === 'server' ? session.quality : undefined;
  if (!quality || (quality.ai !== 'failed' && quality.context)) return null;
  return <div className="notice" role="status"><Info size={18} /><div>
    <strong>기본 방식으로 추천했어요.</strong>
    {!quality.context && <p>지금은 문장의 의미를 분석하지 못해 조건 태그와 평소 취향으로 골랐어요.</p>}
    {quality.ai === 'failed' && <p>AI 설명을 받지 못해 기본 설명으로 보여드려요. 다른 추천 보기를 누르면 다시 시도해요.</p>}
  </div></div>;
}
