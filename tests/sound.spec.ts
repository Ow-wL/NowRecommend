import { test, expect, type Page } from '@playwright/test';

const SEEDED = { version: 2, name: '검증', profiles: { food: { selected: [], tags: [], disliked: [] }, music: { selected: ['m01', 'm02', 'm03', 'm04', 'm05'], tags: [], disliked: [] } }, favorites: [], history: [] };
const slider = (page: Page) => page.getByRole('slider', { name: '미리듣기 볼륨' });
async function openSound(page: Page) {
  await page.getByRole('button', { name: '브라우저 프로필', exact: true }).click();
  await page.getByRole('button', { name: '소리', exact: true }).click();
}

for (const width of [320, 1440]) test(`preview volume starts at half, moves by keyboard and survives a reload at ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  await openSound(page);
  const volume = slider(page);
  await expect(volume).toHaveValue('50');
  await expect(volume).toHaveAttribute('aria-valuetext', '50%');
  await expect(page.locator('.volume-row output')).toHaveText('50%');
  await volume.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(volume).toHaveValue('40');
  await expect(volume).toHaveAttribute('aria-valuetext', '40%');
  await page.keyboard.press('Home');
  await expect(volume).toHaveAttribute('aria-valuetext', '음소거');
  await page.keyboard.press('End');
  await expect(volume).toHaveValue('100');
  await volume.fill('30');
  await expect(volume).toHaveValue('30');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `artifacts/sound-settings-${width}.png` });
  await page.keyboard.press('Escape');
  await page.reload();
  await openSound(page);
  await expect(slider(page)).toHaveValue('30');
  await page.getByRole('button', { name: '기본 볼륨(50%)으로 되돌리기' }).click();
  await expect(slider(page)).toHaveValue('50');
  await expect(page.getByRole('button', { name: /기본 볼륨/ })).toHaveCount(0);
});

test('a playing preview gets quieter at once and the next one starts at the saved volume', async ({ page }) => {
  // Record the app's player and let play() succeed without real audio; the store lookup answers with an Apple address.
  await page.addInitScript(seed => {
    localStorage.setItem('nowrecommend-prototype-v1', JSON.stringify(seed));
    const players: HTMLAudioElement[] = [];
    (window as unknown as { players: HTMLAudioElement[] }).players = players;
    const Original = window.Audio;
    window.Audio = function (src?: string) { const a = new Original(src); players.push(a); return a; } as unknown as typeof Audio;
    HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  }, SEEDED);
  await page.route('https://itunes.apple.com/lookup**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: [{ previewUrl: 'https://audio-ssl.itunes.apple.com/test.m4a' }] }) }));
  await page.goto('/#/recommend/music');
  await page.getByRole('button', { name: /추천받기$/ }).click();
  await expect(page.locator('.result-grid .item-card')).toHaveCount(5);
  const play = page.locator('.result-grid .preview-button').first();
  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'true');
  const playerVolume = () => page.evaluate(() => (window as unknown as { players: HTMLAudioElement[] }).players[0]?.volume);
  expect(await playerVolume()).toBeCloseTo(0.5);
  await openSound(page);
  await slider(page).focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(slider(page)).toHaveValue('35');
  await expect.poll(playerVolume).toBeCloseTo(0.35);
  await page.keyboard.press('Escape');
  await expect(play).toHaveAttribute('aria-pressed', 'true');  // still playing, only quieter
  await page.reload();  // the results come back from this tab's session
  await expect(page.locator('.result-grid .item-card')).toHaveCount(5);
  await page.locator('.result-grid .preview-button').first().click();
  await expect.poll(playerVolume).toBeCloseTo(0.35);
});
