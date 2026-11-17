import { test, expect, type Page, type Route } from '@playwright/test';
import { items } from '../../src/data';

// YouTube's player inside a song's details (src/fullPlay.ts, server/app/youtube.py): the server finds the video when the
// player is opened; YouTube's own player plays it. The server and YouTube are stood in for; nothing leaves the machine.
const API = 'http://127.0.0.1:5999';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
const fulfill = (route: Route, body: unknown, status = 200) =>
  route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: cors }) : route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
const song = items.find(i => i.id === 'm06')!;  // River Flows in You

async function openSong(page: Page, answer: (route: Route) => Promise<void>) {
  const asked: string[] = [], played: string[] = [];
  await page.addInitScript(() => {
    if (!localStorage.getItem('nowrecommend-prototype-v1')) localStorage.setItem('nowrecommend-prototype-v1', JSON.stringify({ version: 2, name: '검증',
      profiles: { food: { selected: ['f01', 'f02', 'f03', 'f04', 'f05'], tags: [], disliked: [] }, music: { selected: ['m01', 'm02', 'm03', 'm04', 'm05'], tags: [], disliked: [] } }, favorites: ['m06'], history: [] }));
  });
  await page.route('https://itunes.apple.com/**', route => route.abort());
  await page.route(`${API}/api/catalog**`, route => fulfill(route, { catalogVersion: 'db-test', items }));
  await page.route(`${API}/api/youtube/**`, route => { asked.push(new URL(route.request().url()).pathname); return answer(route); });
  await page.route('https://www.youtube-nocookie.com/**', route => { played.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>player</title><p>YouTube player</p>' }); });
  await page.goto('/#/favorites');
  await page.getByRole('button', { name: `${song.name} 상세 보기` }).click();
  return { dialog: page.getByRole('dialog'), asked, played };
}

test('a song opens in YouTube\'s player inside the page, only when asked, with the video the server found', async ({ page }) => {
  const { dialog, asked, played } = await openSong(page, route => fulfill(route, { videoId: 'abcdefghijk' }));
  const open = dialog.getByRole('button', { name: 'YouTube로 듣기' });
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  await expect(dialog.locator('iframe')).toHaveCount(0);
  expect(asked).toEqual([]);  // nothing goes to the server or to YouTube before the button
  expect(played).toEqual([]);

  await open.click();
  const frame = dialog.locator('iframe');
  await expect(frame).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/abcdefghijk?rel=0&playsinline=1');
  await expect(frame).toHaveAttribute('title', `${song.name} YouTube 플레이어`);
  await expect(frame).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  await expect(frame.contentFrame().getByText('YouTube player')).toBeVisible();
  expect(asked).toEqual(['/api/youtube/m06']);  // the song by its id, nothing else
  const box = await frame.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(200);
  expect(box!.height).toBeGreaterThanOrEqual(200);  // YouTube's minimum
  await expect(dialog.locator('.full-play.youtube').getByRole('link', { name: 'YouTube 이용약관' })).toHaveAttribute('href', 'https://www.youtube.com/t/terms');
  await expect(dialog.locator('.full-play.youtube').getByRole('link', { name: 'Google 개인정보처리방침' })).toHaveAttribute('href', 'https://policies.google.com/privacy');
  expect(await frame.getAttribute('allow')).not.toContain('autoplay');  // the person presses play in YouTube's player

  // One player at a time: Apple's closes YouTube's, and the other way round.
  const apple = dialog.getByRole('button', { name: 'Apple Music 플레이어 열기' });
  if (await apple.count()) {
    await apple.click();
    await expect(dialog.locator('.full-play.youtube')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'YouTube로 듣기' })).toHaveAttribute('aria-expanded', 'false');
    await dialog.getByRole('button', { name: 'YouTube로 듣기' }).click();
    await expect(dialog.getByRole('button', { name: 'Apple Music 플레이어 열기' })).toBeVisible();
  }
  await expect(dialog.locator('.full-play.youtube iframe')).toHaveCount(1);
  await page.keyboard.press('Escape');  // closing the details takes the player out, which stops the music
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('a song with no video that plays here, or a server that cannot look, keeps the search link', async ({ page }) => {
  let reply: (route: Route) => Promise<void> = route => fulfill(route, { videoId: null });
  const { dialog } = await openSong(page, route => reply(route));
  await dialog.getByRole('button', { name: 'YouTube로 듣기' }).click();
  const panel = dialog.locator('.full-play.youtube');
  await expect(panel).toContainText('재생할 수 있는 영상을 찾지 못했어요');
  await expect(panel.getByRole('link', { name: 'YouTube에서 찾기 (새 탭)' })).toHaveAttribute('href', /youtube\.com\/results/);
  await expect(dialog.locator('iframe')).toHaveCount(0);

  reply = route => fulfill(route, { detail: "오늘은 YouTube 플레이어를 더 열 수 없어요. 'YouTube에서 찾기'로 열어 주세요." }, 429);
  await dialog.getByRole('button', { name: 'YouTube 플레이어 닫기' }).click();
  await dialog.getByRole('button', { name: 'YouTube로 듣기' }).click();
  await expect(panel).toContainText('오늘은 YouTube 플레이어를 더 열 수 없어요');

  reply = route => route.abort();
  await dialog.getByRole('button', { name: 'YouTube 플레이어 닫기' }).click();
  await dialog.getByRole('button', { name: 'YouTube로 듣기' }).click();
  await expect(panel).toContainText('YouTube 플레이어를 열지 못했어요');

  reply = route => fulfill(route, { videoId: 'javascript:x' });  // not a video id: not put in a frame
  await dialog.getByRole('button', { name: 'YouTube 플레이어 닫기' }).click();
  await dialog.getByRole('button', { name: 'YouTube로 듣기' }).click();
  await expect(panel).toContainText('YouTube 플레이어를 열지 못했어요');
  await expect(dialog.locator('iframe')).toHaveCount(0);
});
