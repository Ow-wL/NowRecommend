import { describe, expect, it, vi } from 'vitest';

vi.mock('./media.json', () => ({ default: {
  m01: { image: 'https://example.test/cover.jpg', source: 'itunes', link: 'https://music.apple.com/x' },
  m02: { image: 'https://example.test/guess.jpg', source: 'itunes', check: true },
  m03: { image: 'javascript:alert(1)', source: 'itunes' },
  f01: { image: 'https://upload.wikimedia.org/a.jpg', source: 'commons', credit: { author: 'A', license: 'CC0', licenseUrl: '', page: 'https://commons.wikimedia.org/x' } },
} }));

const { mediaFor, findSong, youtubeSearch } = await import('./media');
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
});
