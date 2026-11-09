import { Copy, ExternalLink, Play, Search, Share2 } from 'lucide-react';
import type { Recommendation } from '../domain';
import { songLink, youtubeSearch } from '../media';
import { ItemArt } from './ItemArt';
import { PreviewButton } from './PreviewButton';

/** This round's songs as one list: a preview and a listen link per song, the whole list to copy or share.
 * There is no account to build a real playlist in, so the list travels as text. */
export function Playlist({ results, onCopy, onShare }: { results: Recommendation[]; onCopy: () => void; onShare: () => void }) {
  return <div className="playlist">
    <p className="modal-description">곡마다 미리 듣고, 들을 곳으로 바로 가요. 목록을 복사하면 메신저나 메모에 붙여 넣을 수 있어요.</p>
    <ol className="playlist-rows">{results.map((r, n) => { const song = songLink(r.item.id); return <li key={r.item.id} className="playlist-row">
      <span className="playlist-index" aria-hidden="true">{n + 1}</span>
      <span className="playlist-art"><ItemArt item={r.item} size="thumb" /><PreviewButton item={r.item} /></span>
      <span className="list-copy"><b>{r.item.name}</b><small>{r.item.subtitle}{r.item.releaseYear ? ` · ${r.item.releaseYear}` : ''}</small></span>
      {song ? <a className="button secondary compact" href={song} target="_blank" rel="noopener noreferrer" aria-label={`${r.item.name} Apple Music에서 듣기 (새 탭)`}><Play size={14} fill="currentColor" />Apple Music</a>
        : <a className="button secondary compact" href={youtubeSearch(r.item)} target="_blank" rel="noopener noreferrer" aria-label={`${r.item.name} YouTube에서 찾기 (새 탭)`}><Search size={14} />YouTube</a>}
    </li>; })}</ol>
    <div className="modal-actions playlist-actions">
      <button className="button secondary" onClick={onCopy}><Copy size={16} />목록 복사</button>
      <button className="button primary" onClick={onShare}><Share2 size={16} />공유</button>
    </div>
    <p className="small muted">링크는 각 서비스의 곡 페이지나 검색 결과예요. <ExternalLink size={12} aria-hidden="true" /> 새 탭에서 열려요.</p>
  </div>;
}
