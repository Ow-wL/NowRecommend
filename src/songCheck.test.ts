import { describe, expect, it, vi } from 'vitest';
import { artistMatches, lookupSong, mediaFromHit, songPage, titleMatches } from './songCheck';

const store = (results: object[]) => ({ ok: true, json: async () => ({ results }) }) as Response;
const hit = { trackName: 'River Flows in You', artistName: 'Yiruma', trackViewUrl: 'https://music.apple.com/us/album/first-love/123?i=456&uo=4', artworkUrl100: 'https://is1.mzstatic.com/x/100x100bb.jpg' };

describe('song check', () => {
  it('matches titles regardless of case, spacing and store suffixes', () => {
    expect(titleMatches('river flows  in you', 'River Flows in You (Remastered)')).toBe(true);
    expect(titleMatches('Letter', 'Letter from Autumn')).toBe(false); // a short title must match exactly
    expect(titleMatches('', 'Anything')).toBe(false);
    expect(artistMatches('Yiruma', 'Yiruma & Friends')).toBe(true);
    expect(artistMatches('이루마', 'Joe Hisaishi')).toBe(false);
  });
  it('builds the song page and the large cover from a store result', () => {
    expect(songPage(hit.trackViewUrl)).toBe('https://music.apple.com/us/song/first-love/456');
    expect(songPage('https://music.apple.com/us/album/first-love/123')).toBeUndefined(); // album page only
    expect(mediaFromHit(hit)).toEqual({ image: 'https://is1.mzstatic.com/x/600x600bb.jpg', source: 'itunes', link: 'https://music.apple.com/us/song/first-love/456' });
    expect(mediaFromHit({ ...hit, artworkUrl100: '' })).toBeUndefined();
  });
  it('tries the Korean store, then the US store, and accepts only the same title and artist', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(store([])).mockResolvedValueOnce(store([{ ...hit, artistName: 'Someone Else' }, hit]));
    await expect(lookupSong('River Flows in You', 'Yiruma', fetcher as typeof fetch)).resolves.toMatchObject({ link: 'https://music.apple.com/us/song/first-love/456' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0][0])).toContain('country=KR');
    expect(String(fetcher.mock.calls[1][0])).toContain('country=US');
  });
  it('reports no match without a guess', async () => {
    const fetcher = vi.fn().mockResolvedValue(store([{ ...hit, trackName: 'Kiss the Rain' }]));
    await expect(lookupSong('River Flows in You', 'Yiruma', fetcher as typeof fetch)).resolves.toBeUndefined();
  });
});
