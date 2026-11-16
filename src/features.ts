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
 * next to a credit and a link to the store. VITE_APPLE_PREVIEWS=off removes the play buttons. */
export function previewsOnOf(env: Env = (import.meta.env ?? {}) as Env): boolean {
  return text(env.VITE_APPLE_PREVIEWS).toLowerCase() !== 'off';
}
export const previewsOn = previewsOnOf();
