import { BookmarkCheck, MousePointerClick, Sparkles } from 'lucide-react';
import type { Category } from '../data';
import { POOR_DAYS, RECENT_DAYS } from '../signals';

// How a choice shapes the next recommendation (2026-11-23), shown as three steps instead of a paragraph:
// pick one → it is kept in the record → the next recommendation changes. What step 3 says is what src/signals.ts does:
// a pick waits a week before it is offered again, a good rating brings similar things forward, a poor one moves it back.
export type LoopStage = 'pick' | 'kept' | 'rated';
export function LearnLoop({ stage, category, rating, compact = false }: {
  stage: LoopStage; category: Category; /** the rating just given, on the completion page */ rating?: 'good' | 'neutral' | 'poor';
  compact?: boolean;
}) {
  const done = stage === 'pick' ? 0 : stage === 'kept' ? 2 : 3;
  const thing = category === 'food' ? '메뉴' : '곡';
  const steps = [
    { icon: MousePointerClick, title: '골라요', text: `마음에 드는 ${thing} 하나` },
    { icon: BookmarkCheck, title: '기록돼요', text: '추천 기록에 남아요' },
    { icon: Sparkles, title: '다음이 달라져요', text: '좋았던 건 더, 아쉬운 건 덜' },
  ];
  const now = stage === 'pick' ? '마음에 드는 걸 고르면 기록에 남고, 다음 추천이 그만큼 나에게 맞춰져요.'
    : stage === 'kept' ? `방금 고른 ${thing}은 ${RECENT_DAYS}일 동안 되도록 뒤로 미뤄, 같은 걸 연달아 추천하지 않으려 해요. 아래에서 평가를 남기면 다음 추천에 반영돼요.`
    : rating === 'good' ? `좋았다고 남겼어요. 다음 ${thing} 추천에서 비슷한 특징을 조금 더 챙겨요.`
    : rating === 'poor' ? `아쉬웠다고 남겼어요. ${POOR_DAYS}일 동안은 되도록 뒤로 미뤄요.`
    : '평가를 남겼어요. 기록에서 언제든 고칠 수 있어요.';
  return <section className={`learn-loop ${category}${compact ? ' compact' : ''}`} aria-label="선택이 다음 추천에 반영되는 방법">
    <ol>{steps.map((s, n) => {
      const state = n < done ? 'done' : n === done ? 'now' : 'later';
      return <li key={s.title} className={state} aria-current={state === 'now' ? 'step' : undefined}>
        <span className="loop-dot" aria-hidden="true"><s.icon size={compact ? 16 : 18} /></span>
        <b>{s.title}</b>{!compact && <small>{s.text}</small>}
      </li>;
    })}</ol>
    <p aria-live="polite">{now}</p>
  </section>;
}
