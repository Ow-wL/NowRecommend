import { apiJson, API_BASE_URL } from './client';

/** GET /api/youtube/{id} (server/app/routes/youtube.py): the video to play a song the service knows, or null when none can be
 * played here. The song goes by its id only; the server looks for it and remembers the answer for a while. */
export type YouTubeAnswer = { videoId: string | null };
export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const validAnswer = (v: unknown): v is YouTubeAnswer =>
  !!v && typeof v === 'object' && 'videoId' in v && ((v as YouTubeAnswer).videoId === null || VIDEO_ID.test(String((v as YouTubeAnswer).videoId)));

export function fetchYouTube(itemId: string, options: { base?: string; fetchImpl?: typeof fetch; signal?: AbortSignal } = {}) {
  const { base = API_BASE_URL, fetchImpl, signal } = options;
  return apiJson(`/api/youtube/${encodeURIComponent(itemId)}`, validAnswer, { base, fetchImpl, signal, timeoutMs: 12000 });
}
