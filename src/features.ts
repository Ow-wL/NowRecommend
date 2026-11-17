// Switches for the parts that depend on another company's terms (checked 2026-11-17, see README "외부 서비스 이용 조건").
// They are build settings, so a launch that takes money or shows ads can turn a part off, or move it to a paid plan,
// without touching code.
const text = (value: unknown) => String(value ?? '').trim();

/** Weather comes from Open-Meteo. Its free API is for non-commercial use only (a site with subscriptions or ads counts as
 * commercial); the paid plan has its own host and a key.
 *   VITE_WEATHER=off          → the "지금 날씨 반영" button is not shown
 *   VITE_OPEN_METEO_KEY=<key> → the paid API (the key is visible in the browser, as with any browser-side key)
 *   neither                   → the free API */
export type WeatherMode = 'off' | 'free' | 'paid';
type Env = Record<string, unknown>;
export function weatherModeOf(env: Env = (import.meta.env ?? {}) as Env): WeatherMode {
  return text(env.VITE_WEATHER).toLowerCase() === 'off' ? 'off' : text(env.VITE_OPEN_METEO_KEY) ? 'paid' : 'free';
}
export const weatherMode = weatherModeOf();
export const openMeteoKey = text(import.meta.env?.VITE_OPEN_METEO_KEY);

/** Thirty-second previews and album covers are Apple's promotional content: allowed to promote the song itself, shown
 * next to a credit and a link to the store. VITE_APPLE_PREVIEWS=off removes the play buttons, and only those: the album
 * covers and the check that an AI-named song exists (browser and server) still use Apple's store. Leaving Apple
 * altogether also takes SONG_STORE_CHECK=false on the server and a catalog without Apple covers. */
export function previewsOnOf(env: Env = (import.meta.env ?? {}) as Env): boolean {
  return text(env.VITE_APPLE_PREVIEWS).toLowerCase() !== 'off';
}
export const previewsOn = previewsOnOf();

/** Apple Music's embed player inside the song details (src/fullPlay.ts): Apple's own player in a frame, opened only when
 * asked for. VITE_APPLE_EMBED=off removes the button; so does VITE_APPLE_PREVIEWS=off, which stands for "no listening
 * through Apple in the page" as a whole. */
export function fullPlayOnOf(env: Env = (import.meta.env ?? {}) as Env): boolean {
  return previewsOnOf(env) && text(env.VITE_APPLE_EMBED).toLowerCase() !== 'off';
}
export const fullPlayOn = fullPlayOnOf();

/** YouTube's player inside the song details (src/fullPlay.ts, server/app/youtube.py): opened only when asked for, with the
 * video the server finds. VITE_YOUTUBE_EMBED=off removes the button (the server needs YOUTUBE_API_KEY besides). */
export function youtubeOnOf(env: Env = (import.meta.env ?? {}) as Env): boolean {
  return text(env.VITE_YOUTUBE_EMBED).toLowerCase() !== 'off';
}
export const youtubeOn = youtubeOnOf();
