import { useCallback, useEffect, useState } from 'react';
import { useCatalog } from './catalog';
import type { Item } from './data';
import { isAiPick } from './knownItems';
import { addMedia, songLink, storeArtist, type Media } from './media';

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
const hangul = /[가-힣]/;
/** Every spelling we know for an artist, the store's own first. Only confirmed catalog covers feed this, never a guess. */
export function artistNames(artist: string, items: Pick<Item, 'id' | 'category' | 'subtitle'>[]): string[] {
  const listed = items.filter(i => i.category === 'music' && norm(i.subtitle) === norm(artist)).map(i => storeArtist(i.id)).filter((n): n is string => !!n);
  return [...new Set([...listed, artist])];
}
/** The store's search answers in English-language stores only (the Korean store always returns nothing). A long Hangul title
 * rarely matches a text search, so the artist's own list is the second place to look. Throws when the store cannot answer. */
export async function lookupSong(title: string, artist: string, names: string[] = [artist], fetcher: typeof fetch = fetch): Promise<Media | undefined> {
  const ask = async (params: Record<string, string>) => {
    const response = await fetcher(`https://itunes.apple.com/search?${new URLSearchParams({ country: 'US', entity: 'song', ...params })}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`store ${response.status}`);
    return ((await response.json()) as { results?: Hit[] }).results || [];
  };
  const pick = (results: Hit[]) => {
    const hit = results.find(r => titleMatches(title, r.trackName || '') && names.some(n => artistMatches(n, r.artistName || '')) && mediaFromHit(r));
    return hit && mediaFromHit(hit);
  };
  const first = pick(await ask({ term: `${names[0]} ${title}`, limit: '10' }));
  if (first || !(hangul.test(title) || names.length > 1)) return first;
  return pick(await ask({ term: names[0], attribute: 'artistTerm', limit: '200' }));
}

function readKept(): Record<string, Media> { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } }
function keep(id: string, media: Media) {
  try { const all = { ...readKept(), [id]: media }; const ids = Object.keys(all); ids.slice(0, Math.max(0, ids.length - MAX_KEPT)).forEach(old => delete all[old]); localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* the check simply runs again next visit */ }
}
Object.entries(readKept()).forEach(([id, media]) => addMedia(id, media));

type Outcome = 'found' | 'missing' | 'failed';
const running = new Map<string, Promise<Outcome>>();
const notListed = new Set<string>();
function checkSong(id: string, title: string, artist: string, names: string[]): Promise<Outcome> {
  if (notListed.has(id)) return Promise.resolve('missing');
  let run = running.get(id);
  if (!run) {
    run = lookupSong(title, artist, names).then((media): Outcome => {
      if (!media) { notListed.add(id); return 'missing'; }
      addMedia(id, media); keep(id, media); return 'found';
    }).catch((): Outcome => 'failed').finally(() => running.delete(id));
    running.set(id, run);
  }
  return run;
}

/** 'known' needs no check (a catalog song, or a song page we already hold). `retry` runs a failed check again. */
export function useSongCheck(item: { id: string; category: string; name: string; subtitle: string }): { status: SongStatus; retry: () => void } {
  const { items } = useCatalog();
  const needed = item.category === 'music' && isAiPick(item.id) && !songLink(item.id);
  const [status, setStatus] = useState<SongStatus>(needed ? 'checking' : 'known');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!needed) return;
    let live = true;
    setStatus('checking');
    void checkSong(item.id, item.name, item.subtitle, artistNames(item.subtitle, items)).then(outcome => { if (live) setStatus(outcome); });
    return () => { live = false; };
  }, [item.id, attempt]);  // eslint-disable-line react-hooks/exhaustive-deps
  return { status, retry: useCallback(() => setAttempt(n => n + 1), []) };
}
