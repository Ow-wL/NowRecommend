import media from './media.json';
import type { Item } from './data';

// Item images: food photos hand-picked from Pexels (saved in public/food), Unsplash and Wikimedia Commons with their credit, album covers from the
// iTunes Search API with the track's Apple Music page (server/app/cli/media.py). Images load from those hosts; an
// item without one, or whose image fails, gets a generated cover instead (ItemArt).
export type Credit = { author: string; license: string; licenseUrl: string; page: string };
// `link`: the track's own Apple Music song page (only when the store listed that exact track); `album`: the album page.
// `regionUnconfirmed`: a real page in another store whose Korean counterpart could not be confirmed, so it is not the main way to listen.
// `guestUnconfirmed`: same title and artist, but the guest the pick names is not shown on the store's result.
export type Media = { image: string; source: 'itunes' | 'unsplash' | 'commons' | 'pexels'; approx?: boolean; guestUnconfirmed?: boolean; regionUnconfirmed?: boolean; link?: string; album?: string; credit?: Credit; /** Apple's 30-second preview, when the store gave one. */ preview?: string };
type Entry = Media & { check?: boolean; match?: string };

const table = media as Record<string, Entry>;
// Covers found at run time for AI picks (songCheck.ts).
const found = new Map<string, Media>();
export const addMedia = (id: string, entry: Media) => { found.set(id, entry); };
const norm = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

const localPhoto = /^food\/[\w-]+\.jpg$/;
/** The same picture at the size of a small tile, where its host can resize it. */
export const tileImage = (url: string) => url.replace('w=960&h=960', 'w=420&h=420').replace('/600x600bb', '/300x300bb');

/** Covers still marked for a person to confirm (`check`) are not shown. A photo saved with the site is served from its base path. */
export function mediaFor(id: string): Media | undefined {
  const entry: Entry | undefined = table[id] || found.get(id);
  if (!entry || entry.check) return undefined;
  if (localPhoto.test(entry.image)) return { ...entry, image: import.meta.env.BASE_URL + entry.image };
  return /^https:\/\//.test(entry.image) ? entry : undefined;
}

/** An item's own image, or that of the general dish it belongs to (뿌링클 → 치킨), which is only ever a reference picture. */
export function mediaOf(item: { id?: string; parentId?: string }): Media | undefined {
  const own = item.id ? mediaFor(item.id) : undefined, parent = !own && item.parentId ? mediaFor(item.parentId) : undefined;
  return own || (parent && { ...parent, approx: true });
}

/** The artist's name as the store lists it, from a catalog cover that was confirmed by hand ("이문세" is listed as "Lee Moon Sae"). */
export function storeArtist(id: string): string | undefined {
  return table[id]?.match?.match(/^.* - (.+?) \[.*\]$/)?.[1];
}

/** A free-form AI song that is also in the catalog gets that song's cover (the lab's B side). */
export function findSong(items: Item[], title: string, artist: string): Item | undefined {
  const key = norm(title) + '|' + norm(artist);
  return items.find(i => i.category === 'music' && norm(i.name) + '|' + norm(i.subtitle) === key);
}

const isSongPage = (link = '') => /^https:\/\/music\.apple\.com\/[a-z]{2}\/song\//.test(link);
/** A song page to listen on, or undefined: then the UI offers a search and never builds a guessed song link. */
export function songLink(id: string): string | undefined {
  const entry = mediaFor(id);
  return !entry?.regionUnconfirmed && isSongPage(entry?.link) ? entry?.link : undefined;
}
/** The song page in another store, for a song we could not confirm in Korea: offered as a secondary choice, marked as such. */
export function overseasLink(id: string): string | undefined {
  const entry = mediaFor(id);
  return entry?.regionUnconfirmed && isSongPage(entry.link) ? entry.link : undefined;
}
// Search pages, not seller integrations: they show what the services list, without availability, price or delivery checks.
export const mapSearch = (item: Pick<Item, 'name'>) => `https://map.naver.com/p/search/${encodeURIComponent(item.name)}`;
export const recipeSearch = (item: Pick<Item, 'name'>) => `https://www.10000recipe.com/recipe/list.html?q=${encodeURIComponent(item.name)}`;
export const youtubeSearch = (item: Pick<Item, 'name' | 'subtitle'>) => `https://www.youtube.com/results?search_query=${encodeURIComponent(item.subtitle + ' ' + item.name)}`;
