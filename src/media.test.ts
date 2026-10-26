import { describe, expect, it, vi } from 'vitest';

vi.mock('./media.json', () => ({ default: {
  m01: { image: 'https://example.test/cover.jpg', source: 'itunes', link: 'https://music.apple.com/x' },
  m04: { image: 'https://example.test/c.jpg', source: 'itunes', link: 'https://music.apple.com/us/song/river-flows-in-you/1436677761', album: 'https://music.apple.com/us/album/river-flows-in-you/1436677753' },
  m05: { image: 'https://example.test/d.jpg', source: 'itunes', album: 'https://music.apple.com/us/album/x/1' },
  m02: { image: 'https://example.test/guess.jpg', source: 'itunes', check: true },
  m03: { image: 'javascript:alert(1)', source: 'itunes' },
  f01: { image: 'https://upload.wikimedia.org/a.jpg', source: 'commons', credit: { author: 'A', license: 'CC0', licenseUrl: '', page: 'https://commons.wikimedia.org/x' } },
} }));

const { mediaFor, findSong, youtubeSearch, songLink, mapSearch, recipeSearch } = await import('./media');
const { items } = await import('./data');

describe('item media', () => {
  it('shows confirmed https images only', () => {
    expect(mediaFor('m01')?.link).toBe('https://music.apple.com/x');
    expect(mediaFor('f01')?.credit?.license).toBe('CC0');
    expect(mediaFor('m02')).toBeUndefined(); // a guessed cover waits for a person
    expect(mediaFor('m03')).toBeUndefined();
    expect(mediaFor('missing')).toBeUndefined();
  });

  it('finds a free-form song in the catalog regardless of case and spacing', () => {
    expect(findSong(items, 'river flows  in you', '이루마')?.id).toBe('m06');
    expect(findSong(items, 'River Flows in You', '다른 가수')).toBeUndefined();
  });

  it('builds the YouTube search link from artist and title', () => {
    expect(youtubeSearch({ name: '밤편지', subtitle: '아이유' })).toBe('https://www.youtube.com/results?search_query=%EC%95%84%EC%9D%B4%EC%9C%A0%20%EB%B0%A4%ED%8E%B8%EC%A7%80');
  });

  it('offers a listen link only for a verified song page; otherwise the UI searches', () => {
    expect(songLink('m04')).toBe('https://music.apple.com/us/song/river-flows-in-you/1436677761');
    expect(songLink('m05')).toBeUndefined(); // album page only
    expect(songLink('m01')).toBeUndefined(); // not a song page
  });

  it('builds food search links, not seller links', () => {
    expect(mapSearch({ name: '쌀국수' })).toBe('https://map.naver.com/p/search/%EC%8C%80%EA%B5%AD%EC%88%98');
    expect(recipeSearch({ name: '쌀국수' })).toBe('https://www.10000recipe.com/recipe/list.html?q=%EC%8C%80%EA%B5%AD%EC%88%98');
  });
});
