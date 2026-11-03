import { Info } from 'lucide-react';
import type { ConditionEditor } from '../domain';

// How the sentence was read, where that changes something: the AI added conditions, or the server was unreachable.
// Words that became no condition are not listed: the recommendation still reads the whole sentence.
export function ParseNotice({ ai, raw, hasConditions }: { ai?: ConditionEditor['ai']; raw: string; hasConditions: boolean }) {
  if (!ai || ai.raw !== raw || ai.source === 'rule' || (ai.source === 'rule+ai' && !hasConditions)) return null;
  return <div className="notice" role="status"><Info size={18} /><div>
    {ai.source === 'rule+ai' && <><strong>AI가 문장을 함께 해석했어요.</strong><p>잘못 해석된 조건은 눌러서 지울 수 있어요.</p></>}
    {ai.source === 'local' && <strong>서버에 연결하지 못해 기본 규칙으로 해석했어요.</strong>}
  </div></div>;
}
