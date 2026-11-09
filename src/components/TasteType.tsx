import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Download, RefreshCw, Share2, Sparkles } from 'lucide-react';
import { downloadFile, shareTypeCard, typeCardDataUrl, typeCardFile } from '../typeCard';
import { categoryLabel, type Category, type Item } from '../data';
import { codeFromAnswers, codeFromItems, MIN_ITEMS_FOR_TYPE, QUESTIONS, sides, typeName, type TasteTypeResult } from '../tasteType';

// The lab's taste type test: answer eight questions, or read it from the registered taste. The result can be asked for right away.
export function TasteType({ results, likedItems, onSave, onRecommend, onBack, onEditTaste, backLabel = '실험실로', owner = '', onNotice }: {
  results: Partial<Record<Category, TasteTypeResult>>; likedItems: Record<Category, Item[]>;
  onSave: (category: Category, result: TasteTypeResult) => void; onRecommend: (category: Category, code: string) => void; onBack: () => void; onEditTaste: (category: Category) => void;
  backLabel?: string; /** The person's name on the card, when they set one. */ owner?: string; onNotice?: (message: string) => void;
}) {
  const [category, setCategory] = useState<Category>('food');
  const [answers, setAnswers] = useState<('a' | 'b')[] | null>(null);
  const questions = QUESTIONS[category], result = results[category], fromTaste = codeFromItems(category, likedItems[category]);
  const finish = (code: string, source: TasteTypeResult['source']) => { onSave(category, { code, date: new Date().toISOString(), source }); setAnswers(null); };
  const answer = (choice: 'a' | 'b') => {
    const next = [...(answers || []), choice];
    if (next.length === questions.length) finish(codeFromAnswers(category, next), 'quiz'); else setAnswers(next);
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.type-question h2, .type-result h2')?.focus());
  };
  const step = answers?.length ?? 0;
  // The card to post, drawn whenever the result changes; a drawing failure just leaves the picture out.
  const [card, setCard] = useState('');
  useEffect(() => { if (!result) { setCard(''); return; } try { setCard(typeCardDataUrl(category, result.code, owner)); } catch { setCard(''); } }, [category, result, owner]);
  const save = async () => { if (!result) return; try { downloadFile(await typeCardFile(category, result.code, owner)); onNotice?.('카드 이미지를 저장했어요.'); } catch { onNotice?.('이미지를 만들지 못했어요.'); } };
  const share = async () => { if (!result) return; const outcome = await shareTypeCard(category, result.code, owner); if (outcome === 'downloaded') onNotice?.('공유 창이 없어 카드 이미지를 저장했어요.'); else if (outcome === 'failed') onNotice?.('지금은 공유할 수 없어요.'); };

  return <>
    <div className="flow-head">
      <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> {backLabel}</button>
      <h1>취향 유형 테스트</h1>
      <p>음식과 음악 취향을 MBTI처럼 네 글자로 나눠 봐요. 재미로 보는 유형이에요.</p>
      <div className="filter-tabs lab-category" role="group" aria-label="테스트 분야">{(['food', 'music'] as Category[]).map(c => <button key={c} aria-pressed={category === c} className={category === c ? 'active' : ''} onClick={() => { setCategory(c); setAnswers(null); }}>{categoryLabel[c]}</button>)}</div>
    </div>
    <div className={`flow-body cat-${category}`}>
      {answers ? <section className="panel type-question">
        <div className="type-progress" role="progressbar" aria-label="테스트 진행" aria-valuemin={0} aria-valuemax={questions.length} aria-valuenow={step}><span style={{ width: `${step / questions.length * 100}%` }} /></div>
        <small>{step + 1} / {questions.length}</small>
        <h2 tabIndex={-1}>{questions[step].text}</h2>
        <div className="type-choices">
          <button className="type-choice" onClick={() => answer('a')}>{questions[step].a}</button>
          <button className="type-choice" onClick={() => answer('b')}>{questions[step].b}</button>
        </div>
        <button className="text-button" onClick={() => setAnswers(step ? answers.slice(0, -1) : null)}>{step ? '이전 질문' : '그만두기'}</button>
      </section> : result ? <section className={`panel type-result ${category}`}>
        <p className="type-code" aria-hidden="true">{result.code.split('').map((l, n) => <b key={n}>{l}</b>)}</p>
        <h2 tabIndex={-1}><span className="sr-only">{result.code} </span>{typeName(category, result.code)}</h2>
        <ul className="type-sides">{sides(category, result.code).map(s => <li key={s.letter}><b>{s.letter}</b>{s.label}</li>)}</ul>
        <p className="muted small">{result.source === 'taste' ? '등록한 취향의 특징으로 정했어요.' : '테스트 답변으로 정했어요.'}</p>
        <div className="type-actions">
          <button className="button primary" onClick={() => onRecommend(category, result.code)}><Sparkles size={16} />이 유형으로 추천받기<ArrowRight size={16} /></button>
          <button className="button secondary" onClick={() => setAnswers([])}><RefreshCw size={16} />다시 테스트</button>
        </div>
        {card && <figure className="type-card">
          <img src={card} alt={`${result.code} ${typeName(category, result.code)} 유형 카드`} />
          <figcaption>
            <span>친구에게 보여줄 카드예요.</span>
            <span className="button-row"><button className="button secondary compact" onClick={() => void share()}><Share2 size={15} />공유</button><button className="button secondary compact" onClick={() => void save()}><Download size={15} />이미지 저장</button></span>
          </figcaption>
        </figure>}
      </section> : <section className="panel type-start">
        <h2 tabIndex={-1}>{categoryLabel[category]} 취향은 어떤 유형일까요?</h2>
        <p>질문 {questions.length}개에 답하면 유형을 알려드려요.</p>
        <div className="type-actions">
          <button className="button primary" onClick={() => setAnswers([])}>테스트 시작<ArrowRight size={16} /></button>
          {fromTaste ? <button className="button secondary" onClick={() => finish(fromTaste, 'taste')}>등록한 취향으로 바로 보기</button>
            : <button className="button secondary" onClick={() => onEditTaste(category)}>취향 {MIN_ITEMS_FOR_TYPE}개 이상 등록하기</button>}
        </div>
      </section>}
    </div>
  </>;
}
