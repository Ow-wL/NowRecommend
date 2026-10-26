import { CATALOG_META, type Item } from '../data';
import { useCatalog } from '../catalog';
import type { Recommendation } from '../domain';
import { mediaFor, youtubeSearch } from '../media';
import { ItemArt } from './ItemArt';
export function ItemDetails({item,reasons}: {item:Item;reasons?:Recommendation}) {
  const catalog=useCatalog();
  const media = mediaFor(item.id);
  return <div className="item-details"><figure className="details-art"><ItemArt item={item} size="hero" />
    {media?.credit && <figcaption>사진: <a href={media.credit.page} target="_blank" rel="noopener noreferrer">{media.credit.author}</a> · {media.credit.licenseUrl ? <a href={media.credit.licenseUrl} target="_blank" rel="noopener noreferrer">{media.credit.license}</a> : media.credit.license} · Wikimedia Commons</figcaption>}
    {media?.source === 'itunes' && <figcaption>앨범 아트: Apple Music</figcaption>}
    {!media && <figcaption>{item.category === 'food' ? '등록된 사진이 없어 기본 그림으로 보여드려요.' : '앨범 아트를 찾지 못해 기본 커버로 보여드려요.'}</figcaption>}
  </figure>
  {item.category === 'music' && <div className="listen-links">{media?.link && <a className="button secondary compact" href={media.link} target="_blank" rel="noopener noreferrer">Apple Music에서 듣기</a>}<a className="button secondary compact" href={youtubeSearch(item)} target="_blank" rel="noopener noreferrer">YouTube에서 검색 (새 탭)</a></div>}
  <p>{item.description || '설명 미등록'}</p><dl><dt>{item.category==='food' ? '주요 재료' : '아티스트'}</dt><dd>{item.category==='food' ? item.ingredients.join(' · ') || '미등록' : item.subtitle || '미등록'}</dd>{item.category==='food' && <><dt>참고 가격 범위</dt><dd>{item.price || '미등록'}</dd><dt>필터용 기준 가격</dt><dd>{item.cost === undefined ? '미등록' : `${item.cost.toLocaleString()}원`}</dd></>}</dl><h3>특징</h3><div className="mini-tags">{item.tags.map(t=><span key={t}>{t}</span>)}</div><h3>추천 근거</h3>{reasons ? <div className="reasons"><p><b>평소 취향</b>{reasons.tasteReason}</p><p><b>이번 상황</b>{reasons.contextReason}</p></div> : <p>이 목록에는 추천 근거가 등록되지 않았어요.</p>}<div className="notice"><div><strong>미검증 샘플 정보</strong><p>출처: {catalog.source==='server' ? '추천 서버 카탈로그' : CATALOG_META.source} · 버전 {catalog.version}</p><p>{item.category==='food' ? '등록된 재료만 표시해요. 실제 재료·알레르기 안전·판매 가격을 보증하지 않아요. 기준 가격은 필터용이며 표시된 가격 범위와 달라요.' : '곡·아티스트 정보는 별도 검수가 필요해요. 외부 검색이며 앱에서 음원을 재생하지 않아요.'}</p></div></div></div>;
}
