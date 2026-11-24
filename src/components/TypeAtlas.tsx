import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { categoryLabel, type Category } from '../data';
import { compareTypes, relatedTypes, sides, TYPE_NAMES, typeName, typeProfile, type TasteTypeResult } from '../tasteType';
import { Modal } from './Modal';
import { TypeArt } from './TypeArt';

// Every type of a category, not only one's own (2026-11-24): a grid to browse, and each type's traits and how it gets on
// with the others. With a result of one's own, each type also says how close it is to it.
export function TypeAtlas({ category, mine }: { category: Category; mine?: TasteTypeResult }) {
  const [open, setOpen] = useState<string | null>(null);
  const codes = Object.keys(TYPE_NAMES[category]);
  return <section className="panel type-atlas" aria-labelledby="type-atlas-title">
    <h2 id="type-atlas-title">{categoryLabel[category]} 유형 16가지 둘러보기</h2>
    <p className="muted small">유형을 누르면 특징과 잘 맞는 유형을 볼 수 있어요.</p>
    <ul className="type-atlas-grid">{codes.map(code => <li key={code}>
      <button className={`type-atlas-card${mine?.code === code ? ' mine' : ''}`} onClick={() => setOpen(code)} aria-label={`${code} ${typeName(category, code)}${mine?.code === code ? ', 내 유형' : ''} 자세히 보기`}>
        <TypeArt category={category} code={code} />
        <span className="type-atlas-code">{code}{mine?.code === code && <em>내 유형</em>}</span>
        <strong>{typeName(category, code)}</strong>
        <small>{typeProfile(category, code)?.line}</small>
      </button>
    </li>)}</ul>
    {open && <TypeSheet category={category} code={open} mine={mine} onPick={setOpen} onClose={() => setOpen(null)} />}
  </section>;
}

function TypeSheet({ category, code, mine, onPick, onClose }: { category: Category; code: string; mine?: TasteTypeResult; onPick: (code: string) => void; onClose: () => void }) {
  const profile = typeProfile(category, code), related = relatedTypes(category, code);
  const withMine = mine && mine.code !== code ? compareTypes(category, mine, { code }) : null;
  return <Modal title={`${code} ${typeName(category, code)}`} onClose={onClose}>
    <div className={`type-sheet cat-${category}`}>
      <div className="type-sheet-hero">
        <TypeArt category={category} code={code} />
        <div>
          {profile && <p className="type-line">{profile.line}</p>}
          <ul className="type-glance" aria-label="네 글자 뜻">{sides(category, code).map(s => <li key={s.letter}><b>{s.letter}</b>{s.label}</li>)}</ul>
        </div>
      </div>
      {mine && (mine.code === code
        ? <p className="type-sheet-mine">내 유형이에요.</p>
        : withMine && <p className="type-sheet-mine">내 유형({mine.code})과 <strong>{withMine.percent}%</strong> · {withMine.verdict}
            {withMine.same.length > 0 && <span> 같은 점: {withMine.same.join(', ')}</span>}</p>)}
      {profile && <>
        <p className="type-about">{profile.summary}</p>
        <div className="type-block"><h3>이런 사람이에요</h3><ul className="type-list">{profile.traits.map(t => <li key={t}>{t}</li>)}</ul></div>
        <div className="type-two">
          <div className="type-block good"><h3>강점</h3><ul className="type-list">{profile.strengths.map(t => <li key={t}>{t}</li>)}</ul></div>
          <div className="type-block care"><h3>이럴 땐 조심</h3><ul className="type-list">{profile.cautions.map(t => <li key={t}>{t}</li>)}</ul></div>
        </div>
        <div className="type-block"><h3>{category === 'food' ? '찰떡 메뉴' : '어울리는 장면'}</h3><p>{profile.picks.join(' · ')}</p></div>
        <div className="type-block"><h3>{category === 'food' ? '같이 먹을 때' : '같이 들을 때'}</h3><p>{profile.together}</p></div>
      </>}
      <div className="type-related">
        <button onClick={() => onPick(related.best.code)}><small>잘 맞는 유형</small><strong>{related.best.code} {related.best.name}</strong><span>{related.best.why}</span><ChevronRight size={16} aria-hidden="true" /></button>
        <button onClick={() => onPick(related.worst.code)}><small>티격태격 유형</small><strong>{related.worst.code} {related.worst.name}</strong><span>{related.worst.why}</span><ChevronRight size={16} aria-hidden="true" /></button>
      </div>
    </div>
  </Modal>;
}
