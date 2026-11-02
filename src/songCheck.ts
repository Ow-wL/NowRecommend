import { useEffect, useState } from 'react';
import { isAiPick } from './knownItems';
import { addMedia, songLink, type Media } from './media';

// An AI pick comes with a title and an artist and nothing else. The Apple store's search tells us whether that song
// exists: a match gives the real cover and the song page, and no match leaves the card marked "곡 정보 확인 필요".
// Same matching rules as server/app/cli/media.py, which fills the catalog's covers.
const KEY = 'nowrecommend-song-check-v1';
const MAX_KEPT = 300;
export type Hit = { trackName?: string; artistName?: string; trackViewUrl?: string; artworkUrl100?: string };
export type SongStatus = 'known' | 'checking' | 'found' | 'missing';

const norm = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const bare = (text: string) => text.replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*$/, ''); // store titles add "(feat. …)", "[Remastered]", " - Live"

export function titleMatches(want: string, got: string): boolean {
  const core = norm(bare(want)), plain = norm(bare(got));
  if (!core) return false;
  return norm(want) === norm(got) || core === plain;
}
export const artistMatches = (want: string, got: string) => { const a = norm(want), b = norm(got); return !!a && !!b && (b.includes(a) || a.includes(b)); };

/** The store's track URL is the album page with ?i=<track id>; Apple Music's song page is /song/<slug>/<track id>. */
export function songPage(trackViewUrl = ''): string | undefined {
  const m = trackViewUrl.match(/^https:\/\/music\.apple\.com\/([a-z]{2})\/album\/([^/?]+)\/\d+\?(?:.*&)?i=(\d+)/);
  return m ? `https://music.apple.com/${m[1]}/song/${m[2]}/${m[3]}` : undefined;
}
export function mediaFromHit(hit: Hit): Media | undefined {
  const link = songPage(hit.trackViewUrl), art = hit.artworkUrl100 || '';
  return link && /^https:\/\//.test(art) ? { image: art.replace('100x100bb', '600x600bb'), source: 'itunes', link } : undefined;
}
/** Asks the Korean store, then the US one, since a name is often listed in only one spelling. */
export async function lookupSong(title: string, artist: string, fetcher: typeof fetch = fetch): Promise<Media | undefined> {
  for (const country of ['KR', 'US']) {
    const url = `https://itunes.apple.com/search?${new URLSearchParams({ term: `${artist} ${title}`, country, entity: 'song', limit: '10' })}`;
    const response = await fetcher(url);
    if (!response.ok) throw new Error(`store ${response.status}`);
    const { results = [] } = await response.json() as { results?: Hit[] };
    const hit = results.find(r => titleMatches(title, r.trackName || '') && artistMatches(artist, r.artistName || ''));
    const media = hit && mediaFromHit(hit);
    if (media) return media;
  }
  return undefined;
}

function readKept(): Record<string, Media> { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } }
function keep(id: string, media: Media) {
  try { const all = { ...readKept(), [id]: media }; const ids = Object.keys(all); ids.slice(0, Math.max(0, ids.length - MAX_KEPT)).forEach(old => delete all[old]); localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* the check simply runs again next visit */ }
}
Object.entries(readKept()).forEach(([id, media]) => addMedia(id, media));

const running = new Map<string, Promise<boolean>>();
const notFound = new Set<string>();
function checkSong(id: string, title: string, artist: string): Promise<boolean> {
  if (notFound.has(id)) return Promise.resolve(false);
  let run = running.get(id);
  if (!run) {
    run = lookupSong(title, artist).then(media => {
      if (!media) { notFound.add(id); return false; }
      addMedia(id, media); keep(id, media); return true;
    }).catch(() => false).finally(() => running.delete(id));
    running.set(id, run);
  }
  return run;
}

/** 'known' needs no check (a catalog song, or a song page we already hold); the card waits on 'checking'. */
export function useSongCheck(item: { id: string; category: string; name: string; subtitle: string }): SongStatus {
  const needed = item.category === 'music' && isAiPick(item.id) && !songLink(item.id);
  const [status, setStatus] = useState<SongStatus>(needed ? 'checking' : 'known');
  useEffect(() => {
    if (!needed) return;
    let live = true;
    setStatus('checking');
    void checkSong(item.id, item.name, item.subtitle).then(found => { if (live) setStatus(found ? 'found' : 'missing'); });
    return () => { live = false; };
  }, [item.id]);  // eslint-disable-line react-hooks/exhaustive-deps
  return status;
}
