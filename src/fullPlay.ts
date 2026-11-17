import { useEffect, useState } from 'react';
import type { Item } from './data';

// Whole songs, inside the page (2026-11-17). Apple Music's own embed player (embed.music.apple.com, the one its "embed"
// share option gives) plays thirty seconds to anyone and the whole song to an Apple Music subscriber who signs in inside
// the player; the sign-in is Apple's own window, and this app never sees the account. It needs no key or membership.
// No Korean service (Melon, Genie, FLO, VIBE, Bugs) and not YouTube Music offers a player or sign-in for other sites:
// for those the app can only open their search (musicApps below). The player is put in the page only when the person
// asks for it: Apple's player, and the lookup that picks its store, are not loaded before that. (Album covers and the
// song check talk to Apple's store earlier, as they always did; this is about the player and what it collects.)
// Whether a signed-in subscriber really hears the whole song here was not tried (no account, 2026-11-17): Apple documents
// it, and the way out to Apple Music itself always stays next to the player.

const SONG_PAGE = /^https:\/\/music\.apple\.com\/([a-z]{2})\/song\/([^/?#]+)\/(\d+)$/;
/** The embed player's address for a song page (songCheck.ts songPage), in that page's store or the one given. */
export function embedAddress(link: string | undefined, storefront?: string): string | undefined {
  const m = (link || '').match(SONG_PAGE);
  return m ? `https://embed.music.apple.com/${storefront && /^[a-z]{2}$/.test(storefront) ? storefront : m[1]}/song/${m[2]}/${m[3]}` : undefined;
}

const inKorea = new Map<string, boolean>();
/** Which store's player to show. The Korean one has Korean labels and is the store a Korean subscription plays from, but a
 * song missing there shows an empty player; so it is used only when Apple's lookup lists the track there. Anything else
 * (not listed, no answer in time) keeps the store of the page we know exists. */
export async function playerStorefront(link: string, fetcher: typeof fetch = fetch, timeoutMs = 2500): Promise<string | undefined> {
  const m = link.match(SONG_PAGE);
  if (!m) return undefined;
  const [, own, , id] = m;
  if (own === 'kr') return 'kr';
  if (!inKorea.has(id)) {
    try {
      const response = await fetcher(`https://itunes.apple.com/lookup?${new URLSearchParams({ id, country: 'KR', entity: 'song' })}`, { signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok) inKorea.set(id, (((await response.json()) as { results?: { trackId?: number }[] }).results || []).some(r => String(r.trackId) === id));
    } catch { /* not known: the page's own store */ }
  }
  return inKorea.get(id) ? 'kr' : own;
}

/** YouTube's player (2026-11-18): the video the server found for the song (server/app/youtube.py), in YouTube's
 * privacy-enhanced mode (youtube-nocookie.com: the viewing does not personalise YouTube or its ads). It plays the whole
 * song to anyone. Not autoplayed: the person presses play in YouTube's own player, which also keeps what the player
 * collects before that to what it collects on loading (Developer Policies III.E.4.i). */
export function youtubeAddress(videoId: string | null | undefined): string | undefined {
  return videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId) ? `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&playsinline=1` : undefined;
}

// YouTube's API policies want the person to have agreed to the policy that covers the player before using it
// (Developer Policies III.A.2): asked once in this browser, for the policy in force, before the first search.
const YOUTUBE_KEY = 'nowrecommend-youtube-terms-v1';
export function youtubeAgreed(version: string): boolean { try { return localStorage.getItem(YOUTUBE_KEY) === version; } catch { return false; } }
export function agreeYoutube(version: string): void { try { localStorage.setItem(YOUTUBE_KEY, version); } catch { /* asked again next time */ } }

// One player for the whole app, like the previews: opening another song's, or the other player, closes this one.
export type Player = 'apple' | 'youtube';
let openId = '', openPlayer: Player = 'apple';
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
export function openFullPlay(id: string, player: Player = 'apple') { openId = id; openPlayer = player; emit(); }
export function closeFullPlay(id?: string) { if (!openId || (id && id !== openId)) return; openId = ''; emit(); }
export function useFullPlayOpen(item: Pick<Item, 'id'>, player: Player = 'apple'): boolean {
  const [, tick] = useState(0);
  useEffect(() => { const listener = () => tick(n => n + 1); listeners.add(listener); return () => { listeners.delete(listener); }; }, []);
  return openId === item.id && openPlayer === player;
}

// Other music apps: their search pages, opened in a new tab. Search pages, not integrations (see media.ts): none of these
// services lets another site play or sign in. Checked 2026-11-17 on a desktop browser; on a phone Melon, Genie and FLO
// open their front page without the words, which is why the details also offer to copy the title.
export type MusicApp = { id: string; name: string; search: (words: string) => string };
const q = encodeURIComponent;
export const musicApps: MusicApp[] = [
  { id: 'melon', name: '멜론', search: words => `https://www.melon.com/search/total/index.htm?q=${q(words)}` },
  { id: 'ytmusic', name: 'YouTube Music', search: words => `https://music.youtube.com/search?q=${q(words)}` },
  { id: 'genie', name: '지니', search: words => `https://www.genie.co.kr/search/searchMain?query=${q(words)}` },
  { id: 'flo', name: 'FLO', search: words => `https://www.music-flo.com/search/all?keyword=${q(words)}` },
  { id: 'vibe', name: 'VIBE', search: words => `https://vibe.naver.com/search?query=${q(words)}` },
  { id: 'bugs', name: '벅스', search: words => `https://music.bugs.co.kr/search/integrated?q=${q(words)}` },
  { id: 'spotify', name: 'Spotify', search: words => `https://open.spotify.com/search/${q(words)}` },
];
/** What to type into a music app to find the song: the artist, then the title. */
export const songWords = (item: Pick<Item, 'name' | 'subtitle'>) => `${item.subtitle} ${item.name}`.trim();

// The app this person opens songs in: this device's own habit, kept in this browser like the preview volume.
const APP_KEY = 'nowrecommend-music-app-v1';
function readApp(): string { try { const id = localStorage.getItem(APP_KEY) || ''; return musicApps.some(app => app.id === id) ? id : ''; } catch { return ''; } }
let chosen = readApp();
const appListeners = new Set<() => void>();
export function rememberMusicApp(id: string) {
  if (!musicApps.some(app => app.id === id) || id === chosen) return;
  chosen = id;
  try { localStorage.setItem(APP_KEY, id); } catch { /* for this visit only */ }
  appListeners.forEach(listener => listener());
}
/** The remembered app, if any, re-rendering when it changes. */
export function useMusicApp(): MusicApp | undefined {
  const [, tick] = useState(0);
  useEffect(() => { const listener = () => tick(n => n + 1); appListeners.add(listener); return () => { appListeners.delete(listener); }; }, []);
  return musicApps.find(app => app.id === chosen);
}
