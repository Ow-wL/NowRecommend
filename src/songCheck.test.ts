import { describe, expect, it, vi } from 'vitest';
import { artistMatches, lookupSong, mediaFromHit, songPage, titleMatches } from './songCheck';

const store = (results: object[]) => ({ ok: true, json: async () => ({ results }) }) as Response;
const hit = { trackName: 'River Flows in You', artistName: 'Yiruma', trackViewUrl: 'https://music.apple.com/us/album/first-love/123?i=456&uo=4', artworkUrl100: 'https://is1.mzstatic.com/x/100x100bb.jpg' };

describe('song check', () => {
  it('matches the same title regardless of case and spacing, ignoring only guest credits', () => {
    expect(titleMatches('river flows  in you', 'River Flows in You')).toBe(true);
    expect(titleMatches('Hype Boy', 'Hype Boy (feat. Someone)')).toBe(true);
    expect(titleMatches('Merry-Go-Round of Life', 'Merry-Go-Round of Life (From "Howl\'s Moving Castle")')).toBe(true);
    expect(titleMatches('', 'Anything')).toBe(false);
  });
  it('does not take another recording or a longer title for the song', () => {
    expect(titleMatches('River Flows in You', 'River Flows in You (Live)')).toBe(false);
    expect(titleMatches('River Flows in You', 'River Flows in You [Remastered]')).toBe(false);
    expect(titleMatches('River Flows in You', 'River Flows in You - Acoustic')).toBe(false);
    expect(titleMatches('Letter', 'Letter from Autumn')).toBe(false);
  });
  it('requires the artist to be a whole credited name', () => {
    expect(artistMatches('Yiruma', 'Yiruma')).toBe(true);
    expect(artistMatches('Yiruma', 'Yiruma & Friends')).toBe(true);
    expect(artistMatches('IU', 'Lee, IU')).toBe(true);
    expect(artistMatches('Lee', 'Lee Isac')).toBe(false); // part of another name
    expect(artistMatches('이루마', 'Joe Hisaishi')).toBe(false);
  });
  it('builds the song page and the large cover from a store result', () => {
    expect(songPage(hit.trackViewUrl)).toBe('https://music.apple.com/us/song/first-love/456');
    expect(songPage('https://music.apple.com/us/album/first-love/123')).toBeUndefined(); // album page only
    expect(mediaFromHit(hit)).toEqual({ image: 'https://is1.mzstatic.com/x/600x600bb.jpg', source: 'itunes', link: 'https://music.apple.com/us/song/first-love/456' });
    expect(mediaFromHit({ ...hit, artworkUrl100: '' })).toBeUndefined();
  });
  it('tries the Korean store, then the US store, with a time limit', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(store([])).mockResolvedValueOnce(store([{ ...hit, artistName: 'Someone Else' }, hit]));
    await expect(lookupSong('River Flows in You', 'Yiruma', fetcher as typeof fetch)).resolves.toMatchObject({ link: 'https://music.apple.com/us/song/first-love/456' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0][0])).toContain('country=KR');
    expect(String(fetcher.mock.calls[1][0])).toContain('country=US');
    expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
  it('tells "not listed" apart from "could not ask"', async () => {
    const none = vi.fn().mockResolvedValue(store([{ ...hit, trackName: 'Kiss the Rain' }]));
    await expect(lookupSong('River Flows in You', 'Yiruma', none as typeof fetch)).resolves.toBeUndefined();
    const down = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(lookupSong('River Flows in You', 'Yiruma', down as typeof fetch)).rejects.toThrow('offline');
    const limited = vi.fn().mockResolvedValue({ ok: false, status: 429 } as Response);
    await expect(lookupSong('River Flows in You', 'Yiruma', limited as typeof fetch)).rejects.toThrow('store 429');
  });
});
