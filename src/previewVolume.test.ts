import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// Fresh module per test: the volume is read from storage once, when the player module loads.
class FakeAudio {
  static made: FakeAudio[] = [];
  volume = 1; src = ''; preload = ''; paused = true;
  constructor() { FakeAudio.made.push(this); }
  addEventListener() {}
  pause() { this.paused = true; }
  async play() { this.paused = false; }
}
let saved: Record<string, string>;
beforeEach(() => {
  vi.resetModules(); FakeAudio.made = []; saved = {};
  vi.stubGlobal('localStorage', { getItem: (k: string) => saved[k] ?? null, setItem: (k: string, v: string) => { saved[k] = v; }, removeItem: (k: string) => { delete saved[k]; } });
  vi.stubGlobal('Audio', FakeAudio);
});
afterEach(() => { vi.unstubAllGlobals(); });

it('starts at half volume and cleans anything that is not a volume', async () => {
  const { DEFAULT_PREVIEW_VOLUME, cleanVolume, getPreviewVolume } = await import('./preview');
  expect(DEFAULT_PREVIEW_VOLUME).toBe(0.5);
  expect(getPreviewVolume()).toBe(0.5);
  expect(cleanVolume(0.3)).toBe(0.3);
  expect(cleanVolume('0.25')).toBe(0.25);
  expect(cleanVolume(0.333)).toBe(0.35);  // steps of 5%
  expect(cleanVolume(-1)).toBe(0);
  expect(cleanVolume(4)).toBe(1);
  expect(cleanVolume(null)).toBe(0.5);
  expect(cleanVolume('')).toBe(0.5);
  expect(cleanVolume('loud')).toBe(0.5);
  expect(cleanVolume(Number.NaN)).toBe(0.5);
});

it('keeps the volume in this browser and reads it back on the next visit', async () => {
  const first = await import('./preview');
  first.setPreviewVolume(0.2);
  expect(saved['nowrecommend-preview-volume-v1']).toBe('0.2');
  vi.resetModules();
  const second = await import('./preview');
  expect(second.getPreviewVolume()).toBe(0.2);
  saved['nowrecommend-preview-volume-v1'] = 'garbage';
  vi.resetModules();
  expect((await import('./preview')).getPreviewVolume()).toBe(0.5);
});

it('plays at the chosen volume and changes a song that is already playing', async () => {
  saved['nowrecommend-preview-volume-v1'] = '0.4';
  const { addMedia } = await import('./media');
  const preview = await import('./preview');
  addMedia('t-vol', { image: 'https://is1-ssl.mzstatic.com/v.jpg', source: 'itunes', link: 'https://music.apple.com/us/song/v/900', preview: 'https://audio-ssl.itunes.apple.com/v.m4a' });
  await preview.togglePreview({ id: 't-vol', category: 'music' });
  const player = FakeAudio.made.at(-1)!;
  expect(player.paused).toBe(false);
  expect(player.volume).toBe(0.4);
  preview.setPreviewVolume(0.1);
  expect(player.volume).toBe(0.1);
  expect(player.paused).toBe(false);  // still playing, only quieter
  preview.setPreviewVolume(0);
  expect(player.volume).toBe(0);
});

it('still changes the volume for this visit when storage is blocked', async () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
  const preview = await import('./preview');
  expect(preview.getPreviewVolume()).toBe(0.5);
  preview.setPreviewVolume(0.7);
  expect(preview.getPreviewVolume()).toBe(0.7);
});

it('knows when a device keeps preview volume on its own buttons', async () => {
  const { canSetVolume } = await import('./preview');
  expect(canSetVolume()).toBe(true);
  vi.stubGlobal('Audio', class { get volume() { return 1; } set volume(_: number) {} });
  expect(canSetVolume()).toBe(false);
});
