/** Current weather near the person, from Open-Meteo (no key, no account). Asked only when they press the button, kept in
 * this tab for half an hour, and sent with coordinates rounded to about a kilometre. */
export type Weather = { temperature: number; rain: boolean; snow: boolean; hot: boolean; cold: boolean; fetchedAt: string };
const KEY = 'nowrecommend-weather-v1', TTL_MS = 30 * 60 * 1000;
type Current = { temperature_2m: number; precipitation: number; weather_code: number };
const SNOW = [71, 73, 75, 77, 85, 86], RAIN = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99];
export function weatherFrom(current: Current, fetchedAt = new Date().toISOString()): Weather {
  const snow = SNOW.includes(current.weather_code);
  const rain = snow || current.precipitation > 0 || RAIN.includes(current.weather_code);
  return { temperature: Math.round(current.temperature_2m), rain, snow, hot: current.temperature_2m >= 28, cold: current.temperature_2m <= 5, fetchedAt };
}
export async function requestWeather(latitude: number, longitude: number, fetcher: typeof fetch = fetch): Promise<Weather> {
  const query = new URLSearchParams({ latitude: latitude.toFixed(2), longitude: longitude.toFixed(2), current: 'temperature_2m,precipitation,weather_code', timezone: 'Asia/Seoul' });
  const response = await fetcher(`https://api.open-meteo.com/v1/forecast?${query}`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`weather ${response.status}`);
  const json = (await response.json()) as { current?: Current };
  if (!json.current || typeof json.current.temperature_2m !== 'number') throw new Error('weather shape');
  const weather = weatherFrom(json.current);
  try { sessionStorage.setItem(KEY, JSON.stringify(weather)); } catch { /* the chips still change for this visit */ }
  return weather;
}
export function readWeather(): Weather | null {
  try { const kept = JSON.parse(sessionStorage.getItem(KEY) || 'null') as Weather | null; return kept && Date.now() - new Date(kept.fetchedAt).getTime() < TTL_MS ? kept : null; } catch { return null; }
}
export function clearWeather() { try { sessionStorage.removeItem(KEY); } catch { /* nothing kept */ } }
export const weatherLabel = (w: Weather) => `${w.temperature}°C${w.snow ? ' · 눈' : w.rain ? ' · 비' : ''}`;
