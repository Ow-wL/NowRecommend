import { useEffect, useState } from 'react';
import type { Item } from './data';
import { mediaFor } from './media';

// Thirty-second previews are Apple's own, served from their hosts for exactly this purpose. A confirmed song page gives the
// track id; the store's lookup gives the preview address. AI picks that the song check found carry the address already.
// One player for the whole app: starting a song stops the one before, and leaving the screen stops it too.
const KEY = 'nowrecommend-preview-v1', MAX_KEPT = 300;
const known = new Map<string, string | null>();  // null: the store has no preview for this song (this session only)
function readKept(): Record<string, string> { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } }
function keep(id: string, url: string) {
  try { const all = { ...readKept(), [id]: url }; const ids = Object.keys(all); ids.slice(0, Math.max(0, ids.length - MAX_KEPT)).forEach(old => delete all[old]); localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* found again next time */ }
}
Object.entries(readKept()).forEach(([id, url]) => known.set(id, url));

export const trackIdOf = (link = '') => link.match(/\/song\/[^/]+\/(\d+)/)?.[1];
const isPreview = (url: unknown): url is string => typeof url === 'string' && /^https:\/\/[^/]*\.apple\.com\//.test(url);

/** The preview address for a song, or undefined when the store has none or could not be asked. Throws only for a network failure. */
export async function previewFor(item: Pick<Item, 'id' | 'category'>, fetcher: typeof fetch = fetch): Promise<string | undefined> {
  if (item.category !== 'music') return undefined;
  if (known.has(item.id)) return known.get(item.id) || undefined;
  const media = mediaFor(item.id);
  let url = isPreview(media?.preview) ? media!.preview : undefined;
  const id = trackIdOf(media?.link);
  if (!url && id) {
    let asked = false;
    for (const country of ['US', 'KR']) {
      try {
        const response = await fetcher(`https://itunes.apple.com/lookup?${new URLSearchParams({ id, country })}`, { signal: AbortSignal.timeout(6000) });
        if (!response.ok) continue;
        asked = true;
        const json = (await response.json()) as { results?: { previewUrl?: string }[] };
        url = json.results?.map(r => r.previewUrl).find(isPreview);
        if (url) break;
      } catch { /* the other store, or nothing */ }
    }
    if (!asked && !url) throw new Error('store unreachable');
  }
  known.set(item.id, url || null);
  if (url) keep(item.id, url);
  return url;
}

// Preview loudness is this device's own setting: kept in this browser apart from the taste store, so it is neither synced
// to the account nor carried in backups. Apple's previews are mastered loud, so it starts at half.
const VOLUME_KEY = 'nowrecommend-preview-volume-v1';
export const DEFAULT_PREVIEW_VOLUME = 0.5;
/** A volume between 0 and 1 in steps of 0.05, or the default for anything that is not a number. */
export function cleanVolume(value: unknown): number {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number)) return DEFAULT_PREVIEW_VOLUME;
  return Math.round(Math.min(1, Math.max(0, number)) * 20) / 20;
}
function readVolume(): number { try { return cleanVolume(localStorage.getItem(VOLUME_KEY)); } catch { return DEFAULT_PREVIEW_VOLUME; } }
let volume = readVolume();
const volumeListeners = new Set<() => void>();
export const getPreviewVolume = () => volume;
/** Set the preview volume, keep it in this browser, and apply it at once to a song that is playing. */
export function setPreviewVolume(value: number) {
  volume = cleanVolume(value);
  try { localStorage.setItem(VOLUME_KEY, String(volume)); } catch { /* applies for this visit only */ }
  if (audio) audio.volume = volume;
  volumeListeners.forEach(listener => listener());
}
/** The preview volume, re-rendering when it changes anywhere in the app. */
export function usePreviewVolume(): number {
  const [, tick] = useState(0);
  useEffect(() => { const listener = () => tick(n => n + 1); volumeListeners.add(listener); return () => { volumeListeners.delete(listener); }; }, []);
  return volume;
}
/** iPhone and iPad keep media volume on the hardware buttons: there an element's volume reads back as 1 whatever is set. */
export function canSetVolume(): boolean {
  try { const probe = new Audio(); probe.volume = 0.5; return Math.abs(probe.volume - 0.5) < 0.01; } catch { return false; }
}

export type PreviewState = 'idle' | 'loading' | 'playing' | 'unavailable' | 'failed';
let audio: HTMLAudioElement | null = null, currentId = '', currentState: PreviewState = 'idle';
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
const settle = (id: string, state: PreviewState) => { if (currentId !== id) return; currentState = state; emit(); };
function player(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio(); audio.preload = 'none'; audio.volume = volume;
    audio.addEventListener('ended', () => { currentId = ''; currentState = 'idle'; emit(); });
    audio.addEventListener('error', () => { if (currentState === 'loading' || currentState === 'playing') settle(currentId, 'failed'); });
  }
  return audio;
}
export function stopPreview() { if (!audio) return; audio.pause(); currentId = ''; currentState = 'idle'; emit(); }
/** Play this song's preview, or stop it when it is the one playing. A song without a preview says so for a moment, then rests. */
export async function togglePreview(item: Pick<Item, 'id' | 'category'>) {
  const element = player();
  if (currentId === item.id && (currentState === 'playing' || currentState === 'loading')) { stopPreview(); return; }
  element.pause(); currentId = item.id; currentState = 'loading'; emit();
  let url: string | undefined, failed = false;
  try { url = await previewFor(item); } catch { failed = true; }
  if (currentId !== item.id) return;
  if (!url) { settle(item.id, failed ? 'failed' : 'unavailable'); setTimeout(() => { if (currentId === item.id && currentState !== 'playing') stopPreview(); }, 3000); return; }
  element.src = url;
  try { await element.play(); settle(item.id, 'playing'); } catch { settle(item.id, 'failed'); }
}
/** This song's state in the shared player. Re-renders whenever the player changes. */
export function usePreview(item: Pick<Item, 'id'>): PreviewState {
  const [, tick] = useState(0);
  useEffect(() => { const listener = () => tick(n => n + 1); listeners.add(listener); return () => { listeners.delete(listener); }; }, []);
  return currentId === item.id ? currentState : 'idle';
}
