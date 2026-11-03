import { describe, expect, it, vi } from 'vitest';
import { artistMatches, artistNames, guestsIn, lookupSong, matchRank, mediaFromHit, songPage, titleMatches } from './songCheck';

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
  it('accepts a listed guest when none was asked, and judges one that was', () => {
    expect(guestsIn('Song (feat. A & B)')).toEqual(['a', 'b']);
    expect(matchRank('Song', 'Song (feat. A)')).toBe(2);              // none asked: fine
    expect(matchRank('Song (feat. A)', 'Song (feat. A)')).toBe(2);    // the asked guest is credited
    expect(matchRank('Song (feat. A)', 'Song', 'Singer & A')).toBe(2); // credited in the artist name
    expect(matchRank('Song (feat. A)', 'Song')).toBe(1);              // not shown: only if nothing better
    expect(matchRank('Song (feat. A)', 'Song (feat. B)')).toBe(0);    // a different guest is not a match
  });
  it('marks a result that shows the song but not the asked guest', async () => {
    const plain = { ...hit, trackName: 'Song' };
    const shown = await lookupSong('Song (feat. A)', 'Yiruma', ['Yiruma'], vi.fn().mockResolvedValue(store([plain])) as typeof fetch);
    expect(shown).toMatchObject({ link: 'https://music.apple.com/us/song/first-love/456', guestUnconfirmed: true });
    const none = await lookupSong('Song', 'Yiruma', ['Yiruma'], vi.fn().mockResolvedValue(store([plain])) as typeof fetch);
    expect(none?.guestUnconfirmed).toBeUndefined();
    const other = await lookupSong('Song (feat. A)', 'Yiruma', ['Yiruma'], vi.fn().mockResolvedValue(store([{ ...hit, trackName: 'Song (feat. B)' }])) as typeof fetch);
    expect(other).toBeUndefined();
  });
  it('keeps a named version apart in both directions', () => {
    expect(matchRank('Song (Live)', 'Song (Live)')).toBe(2);
    expect(matchRank('Song (Live)', 'Song')).toBe(0);
    expect(matchRank('Song', 'Song - Remix')).toBe(0);
  });
  it('prefers the result that credits the asked guest', async () => {
    const plain = { ...hit, trackName: 'Song' }, guest = { ...hit, trackName: 'Song (feat. A)', trackViewUrl: 'https://music.apple.com/us/album/x/1?i=9' };
    const fetcher = vi.fn().mockResolvedValue(store([plain, guest]));
    await expect(lookupSong('Song (feat. A)', 'Yiruma', ['Yiruma'], fetcher as typeof fetch)).resolves.toMatchObject({ link: 'https://music.apple.com/us/song/x/9' });
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
  it('uses one text search for a Latin title, in a store that answers, with a time limit', async () => {
    const fetcher = vi.fn().mockResolvedValue(store([{ ...hit, artistName: 'Someone Else' }, hit]));
    await expect(lookupSong('River Flows in You', 'Yiruma', ['Yiruma'], fetcher as typeof fetch)).resolves.toMatchObject({ link: 'https://music.apple.com/us/song/first-love/456' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toContain('country=US');
    expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
  it('finds a Hangul title in the artist\'s list, under the name the store uses', async () => {
    const korean = { ...hit, trackName: '가로수 그늘아래 서면', artistName: 'Lee Moon Sae' };
    const fetcher = vi.fn().mockResolvedValueOnce(store([])).mockResolvedValueOnce(store([korean]));
    await expect(lookupSong('가로수 그늘 아래 서면', '이문세', ['Lee Moon Sae', '이문세'], fetcher as typeof fetch)).resolves.toBeDefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1][0])).toContain('attribute=artistTerm');
    expect(fetcher.mock.calls[1][1].signal).toBe(fetcher.mock.calls[0][1].signal); // one limit for the whole check
    const other = vi.fn().mockResolvedValue(store([{ ...korean, artistName: 'Someone Else' }]));
    await expect(lookupSong('가로수 그늘 아래 서면', '이문세', ['Lee Moon Sae', '이문세'], other as typeof fetch)).resolves.toBeUndefined();
  });
  it('tells "not listed" apart from "could not ask"', async () => {
    const none = vi.fn().mockResolvedValue(store([{ ...hit, trackName: 'Kiss the Rain' }]));
    await expect(lookupSong('River Flows in You', 'Yiruma', ['Yiruma'], none as typeof fetch)).resolves.toBeUndefined();
    expect(none).toHaveBeenCalledTimes(1);
    const down = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(lookupSong('River Flows in You', 'Yiruma', ['Yiruma'], down as typeof fetch)).rejects.toThrow('offline');
    const limited = vi.fn().mockResolvedValue({ ok: false, status: 429 } as Response);
    await expect(lookupSong('River Flows in You', 'Yiruma', ['Yiruma'], limited as typeof fetch)).rejects.toThrow('store 429');
  });
  it('keeps the artist as asked when the catalog knows no other spelling', () => {
    expect(artistNames('처음 보는 가수', [])).toEqual(['처음 보는 가수']);
  });
});
