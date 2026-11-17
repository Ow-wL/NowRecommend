import { describe, expect, it, vi } from 'vitest';
import { embedAddress, musicApps, playerStorefront, songWords, youtubeAddress } from './fullPlay';
import { fullPlayOnOf, youtubeOnOf } from './features';
import { privacySections, termsSections, type LegalInfo } from './legal';

const page = (store: string, id = '1436677761') => `https://music.apple.com/${store}/song/river-flows-in-you/${id}`;
const answer = (results: unknown[]) => new Response(JSON.stringify({ results }), { status: 200 });

describe("Apple Music's player inside the page", () => {
  it('builds the player address only from a song page of Apple Music itself', () => {
    expect(embedAddress(page('us'))).toBe('https://embed.music.apple.com/us/song/river-flows-in-you/1436677761');
    expect(embedAddress(page('us'), 'kr')).toBe('https://embed.music.apple.com/kr/song/river-flows-in-you/1436677761');
    expect(embedAddress('https://music.apple.com/kr/song/%EC%B2%AB%EB%88%88/123')).toBe('https://embed.music.apple.com/kr/song/%EC%B2%AB%EB%88%88/123');
    expect(embedAddress(page('us'), '../evil')).toBe('https://embed.music.apple.com/us/song/river-flows-in-you/1436677761');  // not a store code: ignored
    for (const other of [undefined, '', 'https://music.apple.com/us/album/x/1?i=2', 'https://music.apple.com.evil.example/us/song/x/1', 'http://music.apple.com/us/song/x/1',
      'https://music.apple.com/us/song/x/1?next=https://evil.example', 'https://music.apple.com/us/song/x/abc', 'javascript:alert(1)']) expect(embedAddress(other)).toBeUndefined();
  });

  it('shows the Korean store only when Apple lists the track there', async () => {
    const asked: string[] = [];
    const listed = vi.fn(async (url: RequestInfo | URL) => { asked.push(String(url)); return answer([{ trackId: 1001 }]); });
    expect(await playerStorefront(page('us', '1001'), listed as typeof fetch)).toBe('kr');
    expect(asked).toEqual(['https://itunes.apple.com/lookup?id=1001&country=KR&entity=song']);
    expect(await playerStorefront(page('us', '1001'), listed as typeof fetch)).toBe('kr');
    expect(listed).toHaveBeenCalledTimes(1);  // asked once per song in a visit

    const absent = vi.fn(async () => answer([]));
    expect(await playerStorefront(page('sg', '1002'), absent as typeof fetch)).toBe('sg');
    const another = vi.fn(async () => answer([{ trackId: 9 }]));  // an answer about some other track is not a listing
    expect(await playerStorefront(page('us', '1003'), another as typeof fetch)).toBe('us');
  });

  it('keeps the store of the page it knows when the lookup fails, and asks again next time', async () => {
    const down = vi.fn(async () => { throw new TypeError('offline'); });
    expect(await playerStorefront(page('us', '2001'), down as typeof fetch)).toBe('us');
    const refused = vi.fn(async () => new Response('', { status: 403 }));
    expect(await playerStorefront(page('us', '2001'), refused as typeof fetch)).toBe('us');
    const back = vi.fn(async () => answer([{ trackId: 2001 }]));
    expect(await playerStorefront(page('us', '2001'), back as typeof fetch)).toBe('kr');  // a failure was not remembered as "not listed"
  });

  it('does not ask at all for a page that is already Korean, or for something that is not a song page', async () => {
    const never = vi.fn();
    expect(await playerStorefront(page('kr', '3001'), never as unknown as typeof fetch)).toBe('kr');
    expect(await playerStorefront('https://example.com/x', never as unknown as typeof fetch)).toBeUndefined();
    expect(never).not.toHaveBeenCalled();
  });

  it('is on unless switched off, and goes with the previews', () => {
    expect(fullPlayOnOf({})).toBe(true);
    expect(fullPlayOnOf({ VITE_APPLE_EMBED: ' OFF ' })).toBe(false);
    expect(fullPlayOnOf({ VITE_APPLE_PREVIEWS: 'off' })).toBe(false);
  });
});

describe('the music apps people already use', () => {
  it('opens each app’s own search over https with the artist and the title', () => {
    const words = songWords({ name: 'Love wins all', subtitle: '아이유' });
    expect(words).toBe('아이유 Love wins all');
    expect(musicApps.map(app => app.name)).toEqual(['멜론', 'YouTube Music', '지니', 'FLO', 'VIBE', '벅스', 'Spotify']);
    for (const app of musicApps) {
      const url = new URL(app.search('아이유 Love wins all & more?'));
      expect(url.protocol).toBe('https:');
      expect(decodeURIComponent(url.href)).toContain('아이유 Love wins all & more?');  // the words stay one value: & and ? are escaped
      expect(url.href).not.toContain(' ');
    }
    expect(new URL(musicApps[0].search('a&b=c')).searchParams.get('q')).toBe('a&b=c');
    expect(new Set(musicApps.map(app => new URL(app.search('x')).hostname)).size).toBe(musicApps.length);
    expect(songWords({ name: '곡', subtitle: '' })).toBe('곡');
  });
});

describe('what the documents say about the player', () => {
  const info = (player: boolean): LegalInfo => ({ operator: '운영자', contact: 'a@b.co', weather: true, previews: true, player });
  const text = (sections: ReturnType<typeof termsSections>) => JSON.stringify(sections);
  it('names what Apple collects, that the account never reaches this service, and that nothing loads before the button', () => {
    const privacy = text(privacySections(info(true)));
    for (const said of ['Apple Music 플레이어 열기', '누른 경우에만', '사이트의 주소', '접속 주소(IP)', '재생한 곡', 'Apple 계정으로 로그인하면', '최대 2년',
      'https://www.apple.com/legal/privacy/data/ko/apple-music-web/', '아이디·비밀번호·로그인 정보나 구독 여부를 받지 않습니다', 'Apple의 쿠키와 저장소를 따로 사용', '버튼을 누르지 않으면 플레이어를 불러오지 않습니다']) expect(privacy).toContain(said);
    const terms = text(termsSections(info(true)));
    expect(terms).toContain('Apple Music 구독과 로그인, 그 곡의 제공 여부에 따릅니다');
    expect(terms).not.toContain('전곡 재생을 하지 않습니다');
  });
  it('says nothing about it where the player is switched off', () => {
    expect(text(privacySections(info(false)))).not.toContain('Apple Music 플레이어');
    expect(text(termsSections(info(false)))).toContain('전곡 재생을 하지 않습니다');
    expect(text(privacySections({ operator: '', contact: '', weather: false, previews: false }))).not.toContain('Apple Music 플레이어');
  });
});

describe("YouTube's player inside the page", () => {
  it('puts only a video id the server gave into the privacy-enhanced player, without autoplay', () => {
    expect(youtubeAddress('abcdefghijk')).toBe('https://www.youtube-nocookie.com/embed/abcdefghijk?rel=0&playsinline=1');
    expect(youtubeAddress('a_b-c1234XY')).toBe('https://www.youtube-nocookie.com/embed/a_b-c1234XY?rel=0&playsinline=1');
    for (const other of [null, undefined, '', 'short', 'abcdefghijkl', '../evil/xx', 'abc?def=ghi', 'javascript:x']) expect(youtubeAddress(other)).toBeUndefined();
  });
  it('is on unless switched off', () => {
    expect(youtubeOnOf({})).toBe(true);
    expect(youtubeOnOf({ VITE_YOUTUBE_EMBED: ' Off ' })).toBe(false);
    expect(youtubeOnOf({ VITE_APPLE_PREVIEWS: 'off' })).toBe(true);  // not Apple's
  });
  it('the documents carry what YouTube asks of a site that uses its API, and only while the player is offered', () => {
    const on: LegalInfo = { operator: '운영자', contact: 'a@b.co', weather: true, previews: true, youtube: true };
    const text = (sections: { title: string; blocks: (string | string[])[] }[]) => sections.flatMap(s => [s.title, ...s.blocks.flat()]).join(' / ');
    const terms = text(termsSections(on)), policy = text(privacySections(on));
    for (const line of ['YouTube 이용약관(https://www.youtube.com/t/terms)에 동의하는 것으로 보며', 'YouTube API 서비스']) expect(terms).toContain(line);
    for (const line of ['YouTube API 서비스', 'https://policies.google.com/privacy', '최대 7일', '30일을 넘지 않음', '이용자의 정보는 보내지 않습니다', '쿠키', '광고', '버튼을 누르지 않으면', '2026-11-18 보완']) expect(policy).toContain(line);
    const off = { ...on, youtube: false };
    expect(text(termsSections(off))).not.toContain('YouTube 이용약관');
    expect(text(privacySections(off))).not.toContain('YouTube API');
  });
});
