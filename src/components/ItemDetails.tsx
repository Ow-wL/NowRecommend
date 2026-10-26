import { CATALOG_META, type Item } from '../data';
import { useCatalog } from '../catalog';
import type { Recommendation } from '../domain';
import { mapSearch, mediaFor, recipeSearch, songLink, youtubeSearch } from '../media';
import { ItemArt } from './ItemArt';
// What helps the decision comes first (ingredients, traits, reasons, where to go next); the catalog source and version
// are technical and stay folded under "데이터 정보".
export function ItemDetails({item,reasons}: {item:Item;reasons?:Recommendation}) {
  const catalog=useCatalog();
  const media = mediaFor(item.id), song = item.category === 'music' ? songLink(item.id) : undefined;
  return <div className="item-details"><figure className="details-art"><ItemArt item={item} size="hero" />
    {media?.credit && <figcaption>사진: <a href={media.credit.page} target="_blank" rel="noopener noreferrer">{media.credit.author}</a> · {media.credit.licenseUrl ? <a href={media.credit.licenseUrl} target="_blank" rel="noopener noreferrer">{media.credit.license}</a> : media.credit.license} · Wikimedia Commons</figcaption>}
    {media?.source === 'itunes' && <figcaption>앨범 아트: Apple Music</figcaption>}
    {!media && <figcaption>{item.category === 'food' ? '등록된 사진이 없어 기본 그림으로 보여드려요.' : '앨범 아트를 찾지 못해 기본 커버로 보여드려요.'}</figcaption>}
  </figure>
  {item.category === 'music' ? <div className="listen-links">{song && <a className="button primary compact" href={song} target="_blank" rel="noopener noreferrer">Apple Music에서 듣기 (새 탭)</a>}<a className="button secondary compact" href={youtubeSearch(item)} target="_blank" rel="noopener noreferrer">YouTube에서 검색 (새 탭)</a></div>
    : <div className="listen-links"><a className="button secondary compact" href={mapSearch(item)} target="_blank" rel="noopener noreferrer">네이버 지도에서 검색 (새 탭)</a><a className="button secondary compact" href={recipeSearch(item)} target="_blank" rel="noopener noreferrer">만개의레시피에서 검색 (새 탭)</a></div>}
  <p>{item.description || '설명 미등록'}</p><dl><dt>{item.category==='food' ? '주요 재료' : '아티스트'}</dt><dd>{item.category==='food' ? item.ingredients.join(' · ') || '미등록' : item.subtitle || '미등록'}</dd></dl><h3>특징</h3><div className="mini-tags">{item.tags.map(t=><span key={t}>{t}</span>)}</div><h3>추천 근거</h3>{reasons ? <div className="reasons"><p><b>평소 취향</b>{reasons.tasteReason}</p><p><b>이번 상황</b>{reasons.contextReason}</p>{reasons.contrast && <p><b>다른 후보와 비교</b>{reasons.contrast}</p>}</div> : <p>이 목록에는 추천 근거가 등록되지 않았어요.</p>}
  <p className="small muted">{item.category==='food' ? '등록된 재료만 표시해요. 실제 판매처의 재료·알레르기 안전은 보장하지 않아요. 검색 결과의 판매 여부·영업·배달은 각 서비스에서 확인해주세요.' : '외부 서비스로 연결해요. 앱에서 음원을 재생하지 않아요.'}</p>
  <details className="data-info"><summary>데이터 정보</summary><p>출처: {catalog.source==='server' ? '추천 서버 카탈로그' : CATALOG_META.source} · 버전 {catalog.version}</p><p>{item.category==='food' ? '검수 전 샘플 데이터예요.' : '곡·아티스트 정보는 별도 검수가 필요해요.'}</p></details></div>;
}
