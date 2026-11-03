import { AlertTriangle, Check, CircleDashed } from 'lucide-react';
import { CATALOG_META, type Item } from '../data';
import { useCatalog } from '../catalog';
import { checkText, conditionChecks, NO_TASTE_REASON, type Conditions, type Recommendation } from '../domain';
import { isAiPick } from '../knownItems';
import { mapSearch, mediaFor, recipeSearch, songLink, youtubeSearch } from '../media';
import { ItemArt } from './ItemArt';
// Why this one comes first: the cards keep only one line, so this is where the rest of the reason and each condition's
// check can be read. Where to go next follows, then what is known about the item; the catalog source stays folded.
export function ItemDetails({item,reasons,conditions}: {item:Item;reasons?:Recommendation;conditions?:Conditions}) {
  const catalog=useCatalog();
  const media = mediaFor(item.id), song = item.category === 'music' ? songLink(item.id) : undefined;
  const checks = reasons && conditions ? conditionChecks(item,conditions) : [];
  return <div className="item-details">
    <div className="details-head"><ItemArt item={item} size="tile" />
      {item.category === 'music' ? <div className="listen-links">{song && <a className="button primary compact" href={song} target="_blank" rel="noopener noreferrer">Apple Music에서 듣기 (새 탭)</a>}<a className="button secondary compact" href={youtubeSearch(item)} target="_blank" rel="noopener noreferrer">YouTube에서 찾기 (새 탭)</a></div>
        : <div className="listen-links"><a className="button secondary compact" href={mapSearch(item)} target="_blank" rel="noopener noreferrer">네이버 지도에서 찾기 (새 탭)</a><a className="button secondary compact" href={recipeSearch(item)} target="_blank" rel="noopener noreferrer">만개의레시피에서 찾기 (새 탭)</a></div>}
    </div>
    {media?.guestUnconfirmed && <p className="song-note">요청한 참여자는 확인하지 못했어요</p>}
    {reasons && <section className="details-why"><h3>{item.category === 'music' && isAiPick(item.id) && !song ? 'AI가 제안한 이유' : '추천 이유'}</h3>
      <div className="reasons">{reasons.tasteReason !== NO_TASTE_REASON && <p><b>평소 취향</b>{reasons.tasteReason}</p>}<p><b>이번 상황</b>{reasons.contextReason}</p>{reasons.contrast && <p><b>이 후보의 특징</b>{reasons.contrast}</p>}</div>
      {checks.length > 0 && <><h4>조건 확인</h4><ul className="condition-checks">{checks.map(c => <li key={c.label} className={`${c.kind} ${c.state}`}>{c.state === 'met' ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : c.state === 'partial' ? <AlertTriangle size={13} aria-hidden="true" /> : <CircleDashed size={13} aria-hidden="true" />}{checkText(c)}</li>)}</ul>
        {checks.some(c => c.state === 'untagged') && <p className="small muted">등록 정보 없음은 데이터에 그 특징이 없다는 뜻이고, 맞지 않는다는 뜻은 아니에요.</p>}</>}
    </section>}
    <p>{item.description || '설명 미등록'}</p><dl><dt>{item.category==='food' ? '주요 재료' : '아티스트'}</dt><dd>{item.category==='food' ? item.ingredients.join(' · ') || '미등록' : item.subtitle || '미등록'}</dd></dl>
    {item.tags.length > 0 && <><h3>특징</h3><div className="mini-tags">{item.tags.map(t=><span key={t}>{t}</span>)}</div></>}
    <p className="small muted">{item.category==='food' ? '등록된 재료만 표시해요. 실제 판매처의 재료·알레르기 안전은 보장하지 않아요. 검색 결과의 판매 여부·영업·배달은 각 서비스에서 확인해주세요.' : '외부 서비스로 연결해요. 앱에서 음원을 재생하지 않아요.'}</p>
    <p className="details-credit">{media?.credit ? <>사진: <a href={media.credit.page} target="_blank" rel="noopener noreferrer">{media.credit.author}</a> · {media.credit.licenseUrl ? <a href={media.credit.licenseUrl} target="_blank" rel="noopener noreferrer">{media.credit.license}</a> : media.credit.license} · {media.source === 'commons' ? 'Wikimedia Commons' : 'Unsplash'}{media.approx ? ' · 메뉴와 비슷한 참고 사진이에요' : ''}</> : media?.source === 'itunes' ? '앨범 아트: Apple Music' : item.category === 'food' ? '등록된 사진이 없어요.' : '앨범 아트를 찾지 못했어요.'}</p>
    <details className="data-info"><summary>데이터 정보</summary>{item.id.startsWith('ai-') && <p>AI가 직접 고른 항목이에요. 이름·정보는 AI의 답을 그대로 저장한 것이라 실제와 다를 수 있어요.</p>}<p>출처: {item.id.startsWith('ai-') ? 'AI 추천 결과' : catalog.source==='server' ? '추천 서버 카탈로그' : CATALOG_META.source} · 버전 {catalog.version}</p><p>{item.category==='food' ? '검수 전 샘플 데이터예요.' : '곡·아티스트 정보는 별도 검수가 필요해요.'}</p></details>
  </div>;
}
