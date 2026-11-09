import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Download, Image as ImageIcon, RefreshCw, Send, Sparkles } from 'lucide-react';
import { downloadFile, shareTypeCard, shareTypeLink, typeCardDataUrl, typeCardFile } from '../typeCard';
import { categoryLabel, type Category, type Item } from '../data';
import { axisLeans, codeFromAnswers, codeFromItems, compareTypes, countsFromAnswers, MIN_ITEMS_FOR_TYPE, parseShared, QUESTIONS, relatedTypes, sides, togetherItems, typeName, typeProfile, type SharedType, type SharedTypes, type TasteTypeResult } from '../tasteType';

const Letters = ({ code }: { code: string }) => <p className="type-code" aria-hidden="true">{code.split('').map((l, n) => <b key={n}>{l}</b>)}</p>;
function Leans({ category, counts }: { category: Category; counts?: number[] }) {
  const leans = axisLeans(category, counts);
  if (!leans.length) return null;
  return <ul className="type-leans" aria-label="축별 성향">{leans.map(l => { const first = l.aPercent >= 50; return <li key={l.aLabel}>
    <span className={first ? 'lead' : ''}>{l.aLabel}<em>{l.aPercent}%</em></span>
    <i aria-hidden="true"><u style={{ width: `${l.aPercent}%` }} /></i>
    <span className={l.aPercent <= 50 ? 'lead' : ''}><em>{100 - l.aPercent}%</em>{l.bLabel}</span>
  </li>; })}</ul>;
}

/** What a friend's link shows: their type, then, once there is a result of one's own, how the two get along. */
function FriendPanel({ category, shared, friend, mine, items, onStart, onClose }: { category: Category; shared: SharedTypes; friend: SharedType; mine?: TasteTypeResult; items: Item[]; onStart: () => void; onClose: () => void }) {
  const who = shared.name ? `${shared.name}님` : '친구', profile = typeProfile(category, friend.code);
  const compared = mine && compareTypes(category, mine, friend), together = mine ? togetherItems(category, mine, friend, items) : [];
  return <section className={`panel type-friend ${category}`}>
    <p className="type-friend-who">{who}의 {categoryLabel[category]} 유형</p>
    <Letters code={friend.code} />
    <h2><span className="sr-only">{friend.code} </span>{typeName(category, friend.code)}</h2>
    {profile && <p className="type-line">{profile.line}</p>}
    {compared && <div className="type-match">
      <p className="type-match-score" tabIndex={-1}><b>{compared.percent}%</b>{compared.verdict}</p>
      {compared.same.length > 0 && <p><strong>통하는 점</strong>{compared.same.join(', ')}</p>}
      {compared.different.length > 0 && <p><strong>갈리는 점</strong>{compared.different.map(d => `나는 ${d.mine}, ${who}은 ${d.theirs}`).join(' · ')}</p>}
      {together.length > 0 && <p><strong>{category === 'food' ? '같이 먹을 메뉴' : '같이 들을 곡'}</strong>{together.map(i => i.name).join(', ')}</p>}
      <small>재미로 보는 궁합이에요.</small>
    </div>}
    <Leans category={category} counts={friend.counts} />
    {!compared && <div className="type-actions"><button className="button primary" onClick={onStart}>나도 테스트하고 궁합 보기<ArrowRight size={16} /></button></div>}
    <button className="text-button" onClick={onClose}>친구 결과 닫기</button>
  </section>;
}

// The lab's taste type test: answer sixteen questions, or read it from the registered taste. The result can be asked for right away, and sent to a friend.
export function TasteType({ results, likedItems, items, onSave, onRecommend, onBack, onEditTaste, backLabel = '실험실로', owner = '', onNotice }: {
  results: Partial<Record<Category, TasteTypeResult>>; likedItems: Record<Category, Item[]>; items: Item[];
  onSave: (category: Category, result: TasteTypeResult) => void; onRecommend: (category: Category, result: TasteTypeResult) => void; onBack: () => void; onEditTaste: (category: Category) => void;
  backLabel?: string; /** The person's name on the card and in the link, when they set one. */ owner?: string; onNotice?: (message: string) => void;
}) {
  const [shared, setShared] = useState<SharedTypes | null>(() => parseShared(window.location.search));
  const [category, setCategory] = useState<Category>(() => shared && !shared.types.food && shared.types.music ? 'music' : 'food');
  const [answers, setAnswers] = useState<('a' | 'b')[] | null>(null);
  const questions = QUESTIONS[category], result = results[category], fromTaste = codeFromItems(category, likedItems[category]);
  const friend = shared?.types[category];
  const profile = result && typeProfile(category, result.code), related = result && relatedTypes(category, result.code);
  const finish = (code: string, source: TasteTypeResult['source'], counts?: number[]) => { onSave(category, { code, date: new Date().toISOString(), source, ...(counts ? { counts } : {}) }); setAnswers(null); };
  const answer = (choice: 'a' | 'b') => {
    const next = [...(answers || []), choice];
    if (next.length === questions.length) finish(codeFromAnswers(category, next), 'quiz', countsFromAnswers(category, next)); else setAnswers(next);
    requestAnimationFrame(() => (document.querySelector<HTMLElement>('.type-question h2') || document.querySelector<HTMLElement>('.type-match-score') || document.querySelector<HTMLElement>('.type-result h2'))?.focus());
  };
  const step = answers?.length ?? 0;
  const closeFriend = () => { setShared(null); window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`); };
  // The card to post, drawn whenever the result changes; a drawing failure just leaves the picture out.
  const [card, setCard] = useState('');
  useEffect(() => { if (!result) { setCard(''); return; } try { setCard(typeCardDataUrl(category, result, owner)); } catch { setCard(''); } }, [category, result, owner]);
  const save = async () => { if (!result) return; try { downloadFile(await typeCardFile(category, result, owner)); onNotice?.('카드 이미지를 저장했어요.'); } catch { onNotice?.('이미지를 만들지 못했어요.'); } };
  const shareCard = async () => { if (!result) return; const outcome = await shareTypeCard(category, result, owner); if (outcome === 'downloaded') onNotice?.('공유 창이 없어 카드 이미지를 저장했어요.'); else if (outcome === 'failed') onNotice?.('지금은 공유할 수 없어요.'); };
  const sendLink = async () => { if (!result) return; const outcome = await shareTypeLink(category, results, owner); if (outcome === 'copied') onNotice?.('링크를 복사했어요. 친구에게 붙여 넣어 보내 보세요.'); else if (outcome === 'failed') onNotice?.('지금은 공유할 수 없어요.'); };

  return <>
    <div className="flow-head">
      <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> {backLabel}</button>
      <h1>취향 유형 테스트</h1>
      <p>음식과 음악 취향을 MBTI처럼 네 글자로 나눠 봐요. 재미로 보는 유형이에요.</p>
      <div className="filter-tabs lab-category" role="group" aria-label="테스트 분야">{(['food', 'music'] as Category[]).map(c => <button key={c} aria-pressed={category === c} className={category === c ? 'active' : ''} onClick={() => { setCategory(c); setAnswers(null); }}>{categoryLabel[c]}</button>)}</div>
    </div>
    <div className={`flow-body cat-${category}`}>
      {!answers && shared && friend && <FriendPanel category={category} shared={shared} friend={friend} mine={result} items={items} onStart={() => setAnswers([])} onClose={closeFriend} />}
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
        <Letters code={result.code} />
        <h2 tabIndex={-1}><span className="sr-only">{result.code} </span>{typeName(category, result.code)}</h2>
        {profile && <p className="type-line">{profile.line}</p>}
        {profile && <p className="type-about">{profile.about}</p>}
        {result.counts ? <Leans category={category} counts={result.counts} /> : <ul className="type-sides">{sides(category, result.code).map(s => <li key={s.letter}><b>{s.letter}</b>{s.label}</li>)}</ul>}
        {profile && <div className="type-picks"><h3>{category === 'food' ? '이 유형의 찰떡 메뉴' : '이 유형이 좋아할 장면'}</h3><ul>{profile.picks.map(p => <li key={p}>{p}</li>)}</ul></div>}
        {related && <div className="type-related">
          <p><small>잘 맞는 유형</small><strong>{related.best.code} {related.best.name}</strong><span>{related.best.why}</span></p>
          <p><small>티격태격 유형</small><strong>{related.worst.code} {related.worst.name}</strong><span>{related.worst.why}</span></p>
        </div>}
        <p className="muted small">{result.source === 'taste' ? '등록한 취향의 특징으로 정했어요. 테스트를 하면 성향 비율까지 볼 수 있어요.' : result.counts ? '테스트 답변으로 정했어요.' : '예전 질문으로 정했어요. 질문이 16개로 늘었으니 다시 하면 성향 비율까지 볼 수 있어요.'}</p>
        <div className="type-actions">
          <button className="button primary" onClick={() => void sendLink()}><Send size={16} />친구에게 보내고 궁합 보기</button>
          <button className="button secondary" onClick={() => onRecommend(category, result)}><Sparkles size={16} />이 유형으로 추천받기</button>
          <button className="button secondary" onClick={() => setAnswers([])}><RefreshCw size={16} />다시 테스트</button>
        </div>
        <p className="muted small">링크에는 유형과 설정한 이름만 담겨요.</p>
        {card && <figure className="type-card">
          <img src={card} alt={`${result.code} ${typeName(category, result.code)} 유형 카드`} />
          <figcaption>
            <span>스토리나 채팅에 올리기 좋은 카드예요.</span>
            <span className="button-row"><button className="button secondary compact" onClick={() => void shareCard()}><ImageIcon size={15} />이미지 공유</button><button className="button secondary compact" onClick={() => void save()}><Download size={15} />저장</button></span>
          </figcaption>
        </figure>}
      </section> : !friend && <section className="panel type-start">
        <h2 tabIndex={-1}>{categoryLabel[category]} 취향은 어떤 유형일까요?</h2>
        <p>질문 {questions.length}개에 답하면 유형과 성향 비율, 잘 맞는 유형을 알려드려요.</p>
        <div className="type-actions">
          <button className="button primary" onClick={() => setAnswers([])}>테스트 시작<ArrowRight size={16} /></button>
          {fromTaste ? <button className="button secondary" onClick={() => finish(fromTaste, 'taste')}>등록한 취향으로 바로 보기</button>
            : <button className="button secondary" onClick={() => onEditTaste(category)}>취향 {MIN_ITEMS_FOR_TYPE}개 이상 등록하기</button>}
        </div>
      </section>}
    </div>
  </>;
}
