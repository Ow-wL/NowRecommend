import { useCallback, useEffect, useState } from 'react';
import { useCatalog } from './catalog';
import type { Item } from './data';
import { isAiPick } from './knownItems';
import { addMedia, songLink, storeArtist, type Media } from './media';

// An AI pick comes with a title and an artist and nothing else. The Apple store's search may list a result with the same
// title and artist: that gives a cover and a song page. It does not prove the same recording, and no match does not prove
// the song does not exist; the card says only what the search returned. A failed request means we do not know yet.
const KEY = 'nowrecommend-song-check-v3';
const MAX_KEPT = 300;
const DEADLINE_MS = 8000; // for the whole check, however many requests it takes
export type Hit = { trackName?: string; artistName?: string; trackViewUrl?: string; artworkUrl100?: string };
export type SongStatus = 'known' | 'checking' | 'found' | 'missing' | 'failed';

const norm = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
// A film credit is never part of the song. Guests are compared apart from the title (see matchRank).
// "(Live)", "[Remastered]" or " - Acoustic" stay in the title, so those versions do not count as the same song.
const guestPart = /\s*[([](?:feat\.?|ft\.?|with)\s+([^)\]]+)[)\]]/gi;
const baseTitle = (text: string) => norm(text.replace(guestPart, '').replace(/\s*[([]from\b.*?[)\]]/gi, '').replace(/\s+-\s+from\b.*$/i, ''));
const creditSplit = /\s*(?:,|&|\/|×|\bfeat\.?|\bft\.?|\bwith\b|\band\b)\s*/i;
export const guestsIn = (text: string) => [...text.matchAll(guestPart)].flatMap(m => m[1].split(creditSplit)).map(norm).filter(Boolean);

/** 0: not this song. 1: same title, but a guest the request names is not shown. 2: same title with nothing against it.
 * No guest asked: a listed guest is fine. A guest asked: that person must be credited, and other guests only is a different song. */
export function matchRank(want: string, got: string, gotArtist = ''): 0 | 1 | 2 {
  const title = baseTitle(want);
  if (!title || title !== baseTitle(got)) return 0;
  const asked = guestsIn(want), listed = guestsIn(got);
  if (!asked.length) return 2;
  const artists = gotArtist.split(creditSplit).map(norm);
  const credited = (g: string) => listed.includes(g) || artists.includes(g);
  if (asked.every(credited)) return 2;
  return listed.length ? 0 : 1;
}
export const titleMatches = (want: string, got: string) => matchRank(want, got) > 0;
/** The asked artist must be one of the credited names as a whole, not a piece of a longer name. */
export function artistMatches(want: string, got: string): boolean {
  const a = norm(want);
  return !!a && [got, ...got.split(creditSplit)].some(name => norm(name) === a);
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
/** Uses the US store: the Korean store returned nothing for every request tried when this was written (2026-11-03). A long
 * Hangul title rarely matches a text search, so the artist's own list is the second place to look. Throws when the store cannot answer. */
export async function lookupSong(title: string, artist: string, names: string[] = [artist], fetcher: typeof fetch = fetch): Promise<Media | undefined> {
  const signal = AbortSignal.timeout(DEADLINE_MS);
  const ask = async (params: Record<string, string>) => {
    const response = await fetcher(`https://itunes.apple.com/search?${new URLSearchParams({ country: 'US', entity: 'song', ...params })}`, { signal });
    if (!response.ok) throw new Error(`store ${response.status}`);
    return ((await response.json()) as { results?: Hit[] }).results || [];
  };
  const pick = (results: Hit[]) => {
    const usable = results.filter(r => names.some(n => artistMatches(n, r.artistName || '')) && mediaFromHit(r));
    const rank = (r: Hit) => matchRank(title, r.trackName || '', r.artistName);
    const sure = usable.find(r => rank(r) === 2), partial = usable.find(r => rank(r) === 1);
    if (sure) return mediaFromHit(sure);
    return partial && { ...mediaFromHit(partial)!, guestUnconfirmed: true };
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
  // Another try also goes back to the store for a song it did not list: a spelling can be all that was missed.
  return { status, retry: useCallback(() => { notListed.delete(item.id); setAttempt(n => n + 1); }, [item.id]) };
}
