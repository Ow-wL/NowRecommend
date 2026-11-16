import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Whole songs inside the page (src/fullPlay.ts): Apple Music's own player in a frame, opened only when asked for, and the
// search pages of the music apps people already use. Apple's hosts are stood in for here; nothing leaves the machine.
const media = JSON.parse(readFileSync(new URL('../src/media.json', import.meta.url), 'utf8')) as Record<string, { link?: string }>;
const link = media.m06.link!;  // River Flows in You
const [, store, slug, track] = link.match(/^https:\/\/music\.apple\.com\/([a-z]{2})\/song\/([^/]+)\/(\d+)$/)!;
const STORE = { version: 2, name: '검증', profiles: { food: { selected: ['f01', 'f02', 'f03', 'f04', 'f05'], tags: [], disliked: [] }, music: { selected: ['m01', 'm02', 'm03', 'm04', 'm05'], tags: [], disliked: [] } }, favorites: ['m06'], history: [] };

async function openSong(page: Page, inKorea: boolean | 'unreachable') {
  const asked: string[] = [];
  await page.addInitScript(store => { if (!localStorage.getItem('nowrecommend-prototype-v1')) localStorage.setItem('nowrecommend-prototype-v1', JSON.stringify(store)); }, STORE);
  await page.route('https://embed.music.apple.com/**', route => { asked.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>player</title><p>Apple Music player</p><button>재생</button>' }); });
  await page.route('https://itunes.apple.com/lookup**', route => inKorea === 'unreachable' ? route.abort()
    : route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ results: inKorea && /country=KR/.test(route.request().url()) ? [{ trackId: Number(track) }] : [] }) }));
  await page.goto('/#/favorites');
  await page.getByRole('button', { name: 'River Flows in You 상세 보기' }).click();
  return { dialog: page.getByRole('dialog'), asked };
}

test('a song opens in Apple Music\'s player inside the page, only when asked, and closes with the details', async ({ page }) => {
  const { dialog, asked } = await openSong(page, true);
  const open = dialog.getByRole('button', { name: 'Apple Music 플레이어 열기' });
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  await expect(dialog.locator('iframe')).toHaveCount(0);
  expect(asked).toEqual([]);  // nothing went to Apple's player before it was asked for
  await expect(dialog.getByRole('link', { name: 'Apple Music에서 듣기 (새 탭)' })).toHaveAttribute('href', link);  // the way out stays

  await open.click();
  const frame = dialog.locator('iframe');
  await expect(frame).toHaveAttribute('src', `https://embed.music.apple.com/kr/song/${slug}/${track}`);  // listed in the Korean store: its player
  await expect(frame).toHaveAttribute('title', 'River Flows in You Apple Music 플레이어');
  await expect(frame).toHaveAttribute('sandbox', /allow-popups.*allow-storage-access-by-user-activation/);  // the sign-in is Apple's own window
  await expect(frame).toHaveAttribute('allow', /encrypted-media/);
  const close = dialog.getByRole('button', { name: 'Apple Music 플레이어 닫기' });
  await expect(close).toHaveAttribute('aria-expanded', 'true');
  await expect(dialog.locator('.full-play')).toContainText('지금 추천은 계정 정보를 받지 않아요');
  await expect(frame.contentFrame().getByText('Apple Music player')).toBeVisible();

  // The frame is one of the stops for the Tab key, between the buttons around it.
  await close.focus();
  for (let i = 0; i < 4 && !(await frame.evaluate(node => node === document.activeElement)); i += 1) await page.keyboard.press('Tab');
  expect(await frame.evaluate(node => node === document.activeElement)).toBe(true);
  await close.click();
  await expect(dialog.locator('iframe')).toHaveCount(0);
  await expect(open).toBeFocused();
  await open.click();
  await expect(dialog.locator('iframe')).toHaveCount(1);
  await page.keyboard.press('Escape');  // closing the details takes the player out of the page, which stops the music
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.getByRole('button', { name: 'River Flows in You 상세 보기' }).click();
  await expect(page.getByRole('dialog').locator('iframe')).toHaveCount(0);  // and it does not come back by itself
});

test('a song Apple does not list in Korea, or a lookup that fails, keeps the store of the page that is known to exist', async ({ page }) => {
  const { dialog } = await openSong(page, false);
  await dialog.getByRole('button', { name: 'Apple Music 플레이어 열기' }).click();
  await expect(dialog.locator('iframe')).toHaveAttribute('src', `https://embed.music.apple.com/${store}/song/${slug}/${track}`);
});
test('the player still opens when the store cannot be asked', async ({ page }) => {
  const { dialog } = await openSong(page, 'unreachable');
  await dialog.getByRole('button', { name: 'Apple Music 플레이어 열기' }).click();
  await expect(dialog.locator('iframe')).toHaveAttribute('src', `https://embed.music.apple.com/${store}/song/${slug}/${track}`);
});

test('the song can be looked up in the music app the person uses, and that app is remembered', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await context.route(/melon\.com|music\.youtube\.com|genie\.co\.kr|music-flo\.com|vibe\.naver\.com|bugs\.co\.kr|spotify\.com/, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>music app</title>' }));
  const { dialog } = await openSong(page, true);
  const words = encodeURIComponent('이루마 River Flows in You');
  await dialog.getByText('내 음악 앱에서 찾기 (멜론 · YouTube Music 등)').click();
  const names = ['멜론', 'YouTube Music', '지니', 'FLO', 'VIBE', '벅스', 'Spotify'];
  for (const name of names) {
    const app = dialog.getByRole('link', { name: `${name}에서 찾기 (새 탭)`, exact: true });
    await expect(app).toHaveAttribute('target', '_blank');
    await expect(app).toHaveAttribute('rel', 'noopener noreferrer');
    expect(await app.getAttribute('href')).toContain(words);
  }
  await expect(dialog.getByRole('link', { name: '멜론에서 찾기 (새 탭)' })).toHaveAttribute('href', `https://www.melon.com/search/total/index.htm?q=${words}`);
  await expect(dialog.locator('.music-apps')).toContainText('다른 사이트 안에서 재생하거나 로그인하는 방법을 제공하지 않아요');

  // Where an app's search does not open (a phone), the words can be pasted.
  await dialog.getByRole('button', { name: '제목·가수 복사' }).click();
  await expect(dialog.locator('.music-apps [role=status]')).toHaveText('복사했어요');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('이루마 River Flows in You');

  // Opening one makes it the first choice from then on, in this browser.
  const [tab] = await Promise.all([context.waitForEvent('page'), dialog.getByRole('link', { name: '멜론에서 찾기 (새 탭)' }).click()]);
  await tab.close();
  await expect(dialog.locator('.music-apps > a')).toHaveText('멜론에서 찾기 (새 탭)');
  await expect(dialog.getByText('다른 음악 앱', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'River Flows in You 상세 보기' }).click();
  await expect(page.getByRole('dialog').locator('.music-apps > a')).toHaveText('멜론에서 찾기 (새 탭)');
  await expect(page.getByRole('dialog').locator('.music-app-list a')).toHaveCount(names.length - 1);
});
