import media from './media.json';
import type { Item } from './data';

// Item images (DESIGN.md v3): food photos curated from Wikimedia Commons with their credit, album covers from the
// iTunes Search API with the track's Apple Music page (server/app/cli/media.py). Images load from those hosts; an
// item without one, or whose image fails, gets a generated cover instead (ItemArt).
export type Credit = { author: string; license: string; licenseUrl: string; page: string };
// `link`: the track's own Apple Music song page (only when the store listed that exact track); `album`: the album page.
export type Media = { image: string; source: 'itunes' | 'commons'; link?: string; album?: string; credit?: Credit };
type Entry = Media & { check?: boolean; match?: string };

const table = media as Record<string, Entry>;
const norm = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Covers still marked for a person to confirm (`check`) are not shown. */
export function mediaFor(id: string): Media | undefined {
  const entry = table[id];
  return entry && !entry.check && /^https:\/\//.test(entry.image) ? entry : undefined;
}

/** A free-form AI song that is also in the catalog gets that song's cover (the lab's B side). */
export function findSong(items: Item[], title: string, artist: string): Item | undefined {
  const key = norm(title) + '|' + norm(artist);
  return items.find(i => i.category === 'music' && norm(i.name) + '|' + norm(i.subtitle) === key);
}

/** A song page to listen on, or undefined: then the UI offers a search and never builds a guessed song link. */
export function songLink(id: string): string | undefined {
  const link = mediaFor(id)?.link;
  return link && /^https:\/\/music\.apple\.com\/[a-z]{2}\/song\//.test(link) ? link : undefined;
}
// Search pages, not seller integrations: they show what the services list, without availability, price or delivery checks.
export const mapSearch = (item: Pick<Item, 'name'>) => `https://map.naver.com/p/search/${encodeURIComponent(item.name)}`;
export const recipeSearch = (item: Pick<Item, 'name'>) => `https://www.10000recipe.com/recipe/list.html?q=${encodeURIComponent(item.name)}`;
export const youtubeSearch = (item: Pick<Item, 'name' | 'subtitle'>) => `https://www.youtube.com/results?search_query=${encodeURIComponent(item.subtitle + ' ' + item.name)}`;
