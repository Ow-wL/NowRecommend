import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, ChevronDown, Download, Image as ImageIcon, RefreshCw, Send, Sparkles } from 'lucide-react';
import { TypeArt } from './TypeArt';
import { downloadFile, shareTypeCard, shareTypeLink, typeCardDataUrl, typeCardFile } from '../typeCard';
import { categoryLabel, type Category, type Item } from '../data';
import { AXES, axisLeans, codeFromItems, codeFromScores, compareTypes, MIN_ITEMS_FOR_TYPE, parseShared, percentsOf, poles, relatedTypes, SCALE, scoresFromAnswers, sides, statements, togetherItems, typeName, typeProfile, type Answer, type SharedType, type SharedTypes, type TasteTypeResult } from '../tasteType';

const Letters = ({ code }: { code: string }) => <p className="type-code" aria-hidden="true">{code.split('').map((l, n) => <b key={n}>{l}</b>)}</p>;
/** The bars, and under each, what the side it leans to means (POLES). `explain` off: the bars alone (a friend's panel). */
function Leans({ category, percents, explain = false }: { category: Category; percents?: number[]; explain?: boolean }) {
  const leans = axisLeans(category, percents);
  if (!leans.length) return null;
  return <ul className="type-leans" aria-label="축별 성향">{leans.map((l, n) => { const first = l.aPercent >= 50; return <li key={l.aLabel}>
    <span className={first ? 'lead' : ''}>{l.aLabel}<em>{l.aPercent}%</em></span>
    <i aria-hidden="true"><u style={{ width: `${l.aPercent}%` }} /></i>
    <span className={l.aPercent <= 50 ? 'lead' : ''}><em>{100 - l.aPercent}%</em>{l.bLabel}</span>
    {explain && <p className="type-pole"><b>{first ? AXES[category][n].a : AXES[category][n].b}</b>{Math.abs(l.aPercent - 50) < 8 ? `두 쪽이 비슷해요. ${first ? poles(category)[n].a : poles(category)[n].b}` : first ? poles(category)[n].a : poles(category)[n].b}</p>}
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
      {profile && <p><strong>{who}과 함께라면</strong>{profile.together}</p>}
      <small>재미로 보는 궁합이에요.</small>
    </div>}
    <Leans category={category} percents={percentsOf(friend)} />
    {!compared && <div className="type-actions"><button className="button primary" onClick={onStart}>나도 테스트하고 궁합 보기<ArrowRight size={16} /></button></div>}
    <button className="text-button" onClick={onClose}>친구 결과 닫기</button>
  </section>;
}

// The taste type test: 24 statements on a 5-point scale, or read from the registered taste. The result page reads like a
// personality profile (src/typeContent.ts): what the type is like, its strengths, where to watch out, how to use the app.
export function TasteType({ results, likedItems, items, onSave, onRecommend, onBack, onEditTaste, backLabel = '', owner = '', onNotice }: {
  results: Partial<Record<Category, TasteTypeResult>>; likedItems: Record<Category, Item[]>; items: Item[];
  onSave: (category: Category, result: TasteTypeResult) => void; onRecommend: (category: Category, result: TasteTypeResult) => void; /** A link back, when the page is opened from somewhere (none: it is a menu page). */ onBack?: () => void; onEditTaste: (category: Category) => void;
  backLabel?: string; /** The person's name on the card and in the link, when they set one. */ owner?: string; onNotice?: (message: string) => void;
}) {
  const [shared, setShared] = useState<SharedTypes | null>(() => parseShared(window.location.search));
  const [category, setCategory] = useState<Category>(() => shared && !shared.types.food && shared.types.music ? 'music' : 'food');
  const [answers, setAnswers] = useState<Answer[] | null>(null);
  const questions = statements(category), result = results[category], fromTaste = codeFromItems(category, likedItems[category]);
  const friend = shared?.types[category];
  const profile = result && typeProfile(category, result.code), related = result && relatedTypes(category, result.code);
  const finish = (code: string, source: TasteTypeResult['source'], scores?: number[]) => { onSave(category, { code, date: new Date().toISOString(), source, ...(scores ? { scores } : {}) }); setAnswers(null); };
  const answer = (value: Answer) => {
    const next = [...(answers || []), value];
    if (next.length === questions.length) { const scores = scoresFromAnswers(category, next); finish(codeFromScores(category, scores), 'quiz', scores); } else setAnswers(next);
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
  const percents = result && percentsOf(result);
  const how = !result ? '' : result.source === 'taste' ? '등록한 취향의 특징으로 정했어요. 테스트를 하면 성향 비율과 축별 설명까지 볼 수 있어요.'
    : result.scores ? `문장 ${questions.length}개에 답한 결과예요.` : '예전 질문으로 정한 결과예요. 문장이 새로 바뀌었으니 다시 하면 더 자세히 볼 수 있어요.';

  return <>
    <div className="flow-head">
      {onBack && <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> {backLabel}</button>}
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
        <div className="type-scale" role="group" aria-label="얼마나 그런가요?">
          {SCALE.map(s => <button key={s.value} className={`type-scale-choice v${s.value + 2}`} onClick={() => answer(s.value)}><i aria-hidden="true" /><span>{s.label}</span></button>)}
        </div>
        <button className="text-button" onClick={() => setAnswers(step ? answers.slice(0, -1) : null)}>{step ? '이전 문장' : '그만두기'}</button>
      </section> : result ? <section className={`panel type-result ${category}`}>
        {/* At a glance (2026-11-23): the picture, the code and name, the four sides in a word each, and three short lines.
            The long reading is folded below for whoever wants it. */}
        <div className="type-hero">
          <TypeArt category={category} code={result.code} />
          <div className="type-hero-copy">
            <Letters code={result.code} />
            <h2 tabIndex={-1}><span className="sr-only">{result.code} </span>{typeName(category, result.code)}</h2>
            {profile && <p className="type-line">{profile.line}</p>}
          </div>
        </div>
        <ul className="type-glance" aria-label="한눈에 보기">{sides(category, result.code).map((s, n) => <li key={s.letter}><b>{s.letter}</b>{s.label}{percents && <em>{s.letter === AXES[category][n].a ? percents[n] : 100 - percents[n]}%</em>}</li>)}</ul>
        {profile && <ul className="type-quick">
          <li className="good"><small>강점</small><span>{profile.strengths[0]}</span></li>
          <li className="care"><small>조심</small><span>{profile.cautions[0]}</span></li>
          <li><small>{category === 'food' ? '찰떡 메뉴' : '어울리는 장면'}</small><span>{profile.picks.join(' · ')}</span></li>
        </ul>}
        {profile && <div className="type-tip"><p><strong>추천 활용 팁</strong>{profile.tip}</p><button className="button primary" onClick={() => onRecommend(category, result)}><Sparkles size={16} />이 유형으로 추천받기</button></div>}
        {related && <div className="type-related">
          <p><small>잘 맞는 유형</small><strong>{related.best.code} {related.best.name}</strong><span>{related.best.why}</span></p>
          <p><small>티격태격 유형</small><strong>{related.worst.code} {related.worst.name}</strong><span>{related.worst.why}</span></p>
        </div>}
        <div className="type-actions">
          <button className="button primary" onClick={() => void sendLink()}><Send size={16} />친구에게 보내고 궁합 보기</button>
          {!profile && <button className="button secondary" onClick={() => onRecommend(category, result)}><Sparkles size={16} />이 유형으로 추천받기</button>}
          <button className="button secondary" onClick={() => setAnswers([])}><RefreshCw size={16} />다시 테스트</button>
        </div>
        {profile && <details className="type-more">
          <summary>이 유형 자세히 읽기<ChevronDown size={16} className="chevron" /></summary>
          <p className="type-about">{profile.summary}</p>
          {percents && <div className="type-block"><h3>네 가지 축</h3><Leans category={category} percents={percents} explain /></div>}
          <div className="type-block"><h3>이런 사람이에요</h3><ul className="type-list">{profile.traits.map(t => <li key={t}>{t}</li>)}</ul></div>
          <div className="type-two">
            <div className="type-block good"><h3>강점</h3><ul className="type-list">{profile.strengths.map(t => <li key={t}>{t}</li>)}</ul></div>
            <div className="type-block care"><h3>이럴 땐 조심</h3><ul className="type-list">{profile.cautions.map(t => <li key={t}>{t}</li>)}</ul></div>
          </div>
          <div className="type-two">
            <div className="type-block"><h3>이럴 때 제일 행복해요</h3><ul className="type-list">{profile.happy.map(t => <li key={t}>{t}</li>)}</ul></div>
            <div className="type-block"><h3>자주 하는 말</h3><ul className="type-quotes">{profile.sayings.map(t => <li key={t}>“{t}”</li>)}</ul></div>
          </div>
          <div className="type-block"><h3>{category === 'food' ? '같이 먹을 때' : '같이 들을 때'}</h3><p>{profile.together}</p></div>
        </details>}
        {!profile && percents && <Leans category={category} percents={percents} explain />}
        <p className="muted small">{how}</p>
        <p className="muted small">링크에는 유형과 성향 비율, 설정한 이름만 담겨요.</p>
        {card && <figure className="type-card">
          <img src={card} alt={`${result.code} ${typeName(category, result.code)} 유형 카드`} />
          <figcaption>
            <span>스토리나 채팅에 올리기 좋은 카드예요.</span>
            <span className="button-row"><button className="button secondary compact" onClick={() => void shareCard()}><ImageIcon size={15} />이미지 공유</button><button className="button secondary compact" onClick={() => void save()}><Download size={15} />저장</button></span>
          </figcaption>
        </figure>}
      </section> : !friend && <section className="panel type-start">
        <h2 tabIndex={-1}>{categoryLabel[category]} 취향은 어떤 유형일까요?</h2>
        <p>문장 {questions.length}개에 얼마나 그런지 답하면 네 글자 유형, 축별 성향 비율, 강점과 조심할 점, 잘 맞는 유형까지 알려드려요. 3분쯤 걸려요.</p>
        <div className="type-actions">
          <button className="button primary" onClick={() => setAnswers([])}>테스트 시작<ArrowRight size={16} /></button>
          {fromTaste ? <button className="button secondary" onClick={() => finish(fromTaste, 'taste')}>등록한 취향으로 바로 보기</button>
            : <button className="button secondary" onClick={() => onEditTaste(category)}>취향 {MIN_ITEMS_FOR_TYPE}개 이상 등록하기</button>}
        </div>
      </section>}
    </div>
  </>;
}
