import { describe, expect, it } from 'vitest';
import { siteName } from './typeCard';

describe('type card', () => {
  it('names the site it was made on, as people type it (2026-11-23: it used to name the old host)', () => {
    expect(siteName({ host: 'nowrec.kr', pathname: '/' })).toBe('nowrec.kr');
    expect(siteName({ host: 'nowrec.kr', pathname: '/index.html' })).toBe('nowrec.kr');
    expect(siteName({ host: 'example.github.io', pathname: '/NowRecommend/' })).toBe('example.github.io/NowRecommend');
    expect(siteName(undefined)).toBe('nowrec.kr');
  });
});
