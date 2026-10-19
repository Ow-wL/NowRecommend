import { Info } from 'lucide-react';
import type { ConditionEditor } from '../domain';

// How the sentence was read: by the server's rules alone, with the AI, or locally because the server was unreachable.
export function ParseNotice({ ai, raw }: { ai?: ConditionEditor['ai']; raw: string }) {
  if (!ai || ai.raw !== raw || (ai.source === 'rule' && !ai.unparsed.length)) return null;
  return <div className="notice" role="status"><Info size={18} /><div>
    {ai.source === 'rule+ai' && <><strong>AI가 문장을 함께 해석했어요.</strong><p>잘못 해석된 조건은 눌러서 지울 수 있어요.</p></>}
    {ai.source === 'local' && <strong>서버에 연결하지 못해 기본 규칙으로 해석했어요.</strong>}
    {ai.unparsed.length > 0 && <p>적용하지 않은 표현: {ai.unparsed.join(', ')}</p>}
  </div></div>;
}
