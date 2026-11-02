import { useCallback, useEffect, useState } from 'react';
import { isAiPick } from './knownItems';
import { addMedia, songLink, type Media } from './media';

// An AI pick comes with a title and an artist and nothing else. The Apple store's search tells us whether that song
// exists: a match gives the real cover and the song page, and no match leaves the card saying so. A failed request is a
// different thing from "not listed": we simply do not know yet, so it says that and offers another try.
const KEY = 'nowrecommend-song-check-v2';
const MAX_KEPT = 300;
const TIMEOUT_MS = 6000;
export type Hit = { trackName?: string; artistName?: string; trackViewUrl?: string; artworkUrl100?: string };
export type SongStatus = 'known' | 'checking' | 'found' | 'missing' | 'failed';

const norm = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
// A guest credit or a film credit is dropped: same recording. "(Live)", "[Remastered]" or " - Acoustic" is another one.
const withoutGuests = (text: string) => text.replace(/\s*[([](feat|ft|with|from)\b.*?[)\]]/gi, '').replace(/\s+-\s+from\b.*$/i, '');

export const titleMatches = (want: string, got: string) => { const a = norm(withoutGuests(want)); return !!a && a === norm(withoutGuests(got)); };
/** The asked artist must be one of the credited names as a whole, not a piece of a longer name. */
export function artistMatches(want: string, got: string): boolean {
  const a = norm(want);
  return !!a && [got, ...got.split(/\s*(?:,|&|\/|×|\bfeat\.?|\bft\.?|\bwith\b|\band\b)\s*/i)].some(name => norm(name) === a);
}

/** The store's track URL is the album page with ?i=<track id>; Apple Music's song page is /song/<slug>/<track id>. */
export function songPage(trackViewUrl = ''): string | undefined {
  const m = trackViewUrl.match(/^https:\/\/music\.apple\.com\/([a-z]{2})\/album\/([^/?]+)\/\d+\?(?:.*&)?i=(\d+)/);
  return m ? `https://music.apple.com/${m[1]}/song/${m[2]}/${m[3]}` : undefined;
}
export function mediaFromHit(hit: Hit): Media | undefined {
  const link = songPage(hit.trackViewUrl), art = hit.artworkUrl100 || '';
  return link && /^https:\/\//.test(art) ? { image: art.replace('100x100bb', '600x600bb'), source: 'itunes', link } : undefined;
}
/** Asks the Korean store, then the US one, since a name is often listed in only one spelling. Throws when a store cannot answer. */
export async function lookupSong(title: string, artist: string, fetcher: typeof fetch = fetch): Promise<Media | undefined> {
  for (const country of ['KR', 'US']) {
    const url = `https://itunes.apple.com/search?${new URLSearchParams({ term: `${artist} ${title}`, country, entity: 'song', limit: '10' })}`;
    const response = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
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

type Outcome = 'found' | 'missing' | 'failed';
const running = new Map<string, Promise<Outcome>>();
const notListed = new Set<string>();
function checkSong(id: string, title: string, artist: string): Promise<Outcome> {
  if (notListed.has(id)) return Promise.resolve('missing');
  let run = running.get(id);
  if (!run) {
    run = lookupSong(title, artist).then((media): Outcome => {
      if (!media) { notListed.add(id); return 'missing'; }
      addMedia(id, media); keep(id, media); return 'found';
    }).catch((): Outcome => 'failed').finally(() => running.delete(id));
    running.set(id, run);
  }
  return run;
}

/** 'known' needs no check (a catalog song, or a song page we already hold). `retry` runs a failed check again. */
export function useSongCheck(item: { id: string; category: string; name: string; subtitle: string }): { status: SongStatus; retry: () => void } {
  const needed = item.category === 'music' && isAiPick(item.id) && !songLink(item.id);
  const [status, setStatus] = useState<SongStatus>(needed ? 'checking' : 'known');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!needed) return;
    let live = true;
    setStatus('checking');
    void checkSong(item.id, item.name, item.subtitle).then(outcome => { if (live) setStatus(outcome); });
    return () => { live = false; };
  }, [item.id, attempt]);  // eslint-disable-line react-hooks/exhaustive-deps
  return { status, retry: useCallback(() => setAttempt(n => n + 1), []) };
}
