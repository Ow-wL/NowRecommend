import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, MapPin, Play, RefreshCw } from 'lucide-react';
import type { Category, Item } from '../data';
import type { Preset, Profile } from '../domain';
import { mapSearch, mediaOf, songLink, youtubeSearch } from '../media';
import { deferred, rankingProfile, type Signals } from '../signals';
import { describePair, pairRequest, recommendPairs, replaceSong, withSeen, type Pair, type PairRequest, type Seen } from '../pairing';
import { ItemArt } from './ItemArt';
import { PreviewButton } from './PreviewButton';

type Round = { request: PairRequest; pairs: Pair[]; seen: Seen };
const EXAMPLES = ['비 오는 날 혼자 먹는 국물', '친구랑 매콤하게 신나는 노래', '담백한 저녁에 잔잔한 곡'];
const KEY = 'nowrecommend-pair-v1';

/** This tab's last set, so leaving for the record or a map and coming back does not lose it. Ids only: items may have changed. */
function restore(items: Item[]): Round | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (!saved?.request?.conditions || !Array.isArray(saved.ids)) return null;
    const find = (id: string) => items.find(i => i.id === id);
    const pairs = saved.ids.flatMap(([food, song]: [string, string]) => { const f = find(food), s = find(song); return f && s ? [describePair(f, s, saved.request)] : []; });
    return pairs.length ? { request: saved.request, pairs, seen: saved.seen } : null;
  } catch { return null; }
}
function keep(round: Round | null) {
  try {
    if (round) sessionStorage.setItem(KEY, JSON.stringify({ request: round.request, ids: round.pairs.map(p => [p.food.id, p.song.id]), seen: round.seen }));
    else sessionStorage.removeItem(KEY);
  } catch { /* Only costs the return trip. */ }
}

export function Pairing({ items, profiles, signals, moment, onChoose, onHome, notify }: {
  items: Item[]; profiles: Record<Category, Profile>; signals: Record<Category, Signals>; moment: Record<Category, Preset>;
  onChoose: (pair: Pair, request: PairRequest) => void; onHome: () => void; notify: (message: string) => void;
}) {
  const [raw, setRaw] = useState('');
  const [round, setRoundState] = useState<Round | null>(() => restore(items));
  const [chosen, setChosen] = useState<string[]>([]);
  const heading = useRef<HTMLHeadingElement>(null), focusHeading = useRef(false);
  useEffect(() => { if (focusHeading.current) { focusHeading.current = false; heading.current?.focus(); window.scrollTo(0, 0); } }, [round]);
  const setRound = (next: Round | null) => { keep(next); setRoundState(next); };

  const ranked = (request: PairRequest) => ({ food: rankingProfile(profiles.food, signals.food, 'food', request.conditions.food.tags), music: rankingProfile(profiles.music, signals.music, 'music', request.conditions.music.tags) });
  // Past choices start out as already shown, so a new set leads with something else.
  function ask(request: PairRequest, seen: Seen = { food: deferred(signals.food, request.raw).map(i => i.id), music: deferred(signals.music, request.raw).map(i => i.id) }) {
    const pairs = recommendPairs(request, ranked(request), items, seen);
    if (!pairs.length) { notify('조건에 맞는 조합을 찾지 못했어요. 제외 조건을 줄여 보세요.'); return; }
    focusHeading.current = true; setChosen([]);
    setRound({ request, pairs, seen: withSeen(seen, pairs) });
  }
  function otherSong(pair: Pair) {
    if (!round) return;
    const next = replaceSong(pair, round.pairs, round.request, ranked(round.request), items, round.seen);
    if (!next) { notify('이 메뉴에 더 보여 드릴 곡이 없어요.'); return; }
    const pairs = round.pairs.map(p => p === pair ? next : p);
    setChosen(c => c.filter(id => id !== pair.food.id));
    setRound({ ...round, pairs, seen: withSeen(round.seen, pairs) });
  }

  if (!round) return <div className="pair-page">
    <button className="back-link" onClick={onHome}><ArrowLeft size={16} /> 홈으로</button>
    <h1 className="pair-title">음식과 음악을 같이 골라요</h1>
    <p className="pair-intro">메뉴를 고르고, 그 메뉴에 어울리는 곡을 붙여 드려요.</p>
    <section className="panel compose-panel">
      <label className="field-title" htmlFor="pair-situation">지금의 상황</label>
      <textarea id="pair-situation" rows={3} maxLength={300} value={raw} onChange={e => setRaw(e.target.value)} placeholder="비워 두면 지금 시간에 맞춰 골라요" />
      <div className="textarea-caption">
        <div className={`example-row${raw ? ' quiet' : ''}`}>{EXAMPLES.map(text => <button key={text} onClick={() => setRaw(text)}>{text}</button>)}</div>
        <span>{raw.length}/300</span>
      </div>
    </section>
    <button className="button primary pair-submit" onClick={() => ask(pairRequest(raw, moment))}>같이 추천받기 <ArrowRight size={17} /></button>
  </div>;

  return <div className="pair-page">
    <button className="back-link" onClick={() => setRound(null)}><ArrowLeft size={16} /> 상황 바꾸기</button>
    <h1 className="pair-title" ref={heading} tabIndex={-1}>{round.request.label}</h1>
    <p className="pair-intro">메뉴마다 어울리는 곡을 붙였어요.</p>
    <div className="pair-list">{round.pairs.map(pair => {
      const { food, song } = pair, done = chosen.includes(food.id), link = songLink(song.id);
      return <article className="pair-card" key={food.id}>
        <div className="pair-sides">
          <div className="pair-side">
            <ItemArt item={food} size="tile" />
            <div className="pair-text">
              <h2>{food.name}</h2>
              <p>{food.subtitle}</p>
              {mediaOf(food)?.approx && <p>이미지는 참고용이에요</p>}
              <a className="text-button" href={mapSearch(food)} target="_blank" rel="noopener noreferrer" aria-label={`${food.name} 네이버 지도에서 찾기 (새 탭)`}><MapPin size={15} />지도에서 찾기</a>
            </div>
          </div>
          <div className="pair-side">
            <div className="art-frame"><ItemArt item={song} size="tile" /><PreviewButton item={song} /></div>
            <div className="pair-text">
              <h2>{song.name}</h2>
              <p>{song.subtitle}</p>
              <a className="text-button" href={link || youtubeSearch(song)} target="_blank" rel="noopener noreferrer" aria-label={`${song.name} ${link ? 'Apple Music에서 듣기' : 'YouTube에서 찾기'} (새 탭)`}><Play size={14} fill="currentColor" />{link ? '듣기' : 'YouTube에서 찾기'}</a>
            </div>
          </div>
        </div>
        <div className="pair-why">
          <p>{pair.reason}</p>
          {pair.links.length > 0 && <ul aria-label="연결된 특징">{pair.links.map(l => <li key={l.music}>{l.food}<ArrowRight size={12} aria-label="에 맞춘" />{l.music}</li>)}</ul>}
        </div>
        <div className="pair-actions">
          <button className="button primary" disabled={done} aria-label={`${food.name}, ${song.name} 조합 기록`} onClick={() => { setChosen(c => [...c, food.id]); onChoose(pair, round.request); }}>{done ? '기록했어요' : '이 조합으로'}</button>
          <button className="button secondary" aria-label={`${food.name}에 다른 곡`} onClick={() => otherSong(pair)}><RefreshCw size={15} />다른 곡</button>
        </div>
      </article>;
    })}</div>
    <div className="pair-more"><button className="button secondary" onClick={() => ask(round.request, round.seen)}>다른 조합 보기</button></div>
  </div>;
}
