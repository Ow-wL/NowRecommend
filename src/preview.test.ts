import { expect, it, vi } from 'vitest';
import { addMedia } from './media';
import { previewFor, trackIdOf } from './preview';
it('reads the track id from a song page only', () => {
  expect(trackIdOf('https://music.apple.com/us/song/river-flows-in-you/1440752153')).toBe('1440752153');
  expect(trackIdOf('https://music.apple.com/us/album/first-love/1440752100')).toBeUndefined();
  expect(trackIdOf(undefined)).toBeUndefined();
});
it('asks the store for the preview once, accepts only an Apple address, and remembers a song without one', async () => {
  addMedia('t-prev', { image: 'https://is1-ssl.mzstatic.com/a.jpg', source: 'itunes', link: 'https://music.apple.com/us/song/x/555' });
  const fetcher = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify({ results: [{ previewUrl: String(url).includes('country=US') ? 'https://audio-ssl.itunes.apple.com/p.m4a' : 'https://evil.example/p.m4a' }] }), { status: 200 }));
  expect(await previewFor({ id: 't-prev', category: 'music' }, fetcher as unknown as typeof fetch)).toBe('https://audio-ssl.itunes.apple.com/p.m4a');
  expect(await previewFor({ id: 't-prev', category: 'music' }, fetcher as unknown as typeof fetch)).toBe('https://audio-ssl.itunes.apple.com/p.m4a');
  expect(fetcher).toHaveBeenCalledTimes(1);
  addMedia('t-none', { image: 'https://is1-ssl.mzstatic.com/b.jpg', source: 'itunes', link: 'https://music.apple.com/us/song/y/556' });
  const empty = vi.fn(async () => new Response(JSON.stringify({ results: [{}] }), { status: 200 }));
  expect(await previewFor({ id: 't-none', category: 'music' }, empty as unknown as typeof fetch)).toBeUndefined();
  expect(empty).toHaveBeenCalledTimes(2);  // US, then KR
  expect(await previewFor({ id: 't-none', category: 'music' }, empty as unknown as typeof fetch)).toBeUndefined();
  expect(empty).toHaveBeenCalledTimes(2);
  expect(await previewFor({ id: 'f01', category: 'food' }, empty as unknown as typeof fetch)).toBeUndefined();
  addMedia('t-direct', { image: 'https://is1-ssl.mzstatic.com/c.jpg', source: 'itunes', link: 'https://music.apple.com/us/song/z/557', preview: 'https://audio-ssl.itunes.apple.com/direct.m4a' });
  expect(await previewFor({ id: 't-direct', category: 'music' }, empty as unknown as typeof fetch)).toBe('https://audio-ssl.itunes.apple.com/direct.m4a');
  expect(empty).toHaveBeenCalledTimes(2);
});
