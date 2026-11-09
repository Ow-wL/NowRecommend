import { test, expect, type Page } from '@playwright/test';

async function answerAll(page: Page, side: 'first' | 'last' = 'first') {
  for (let i = 0; i < 16; i++) await page.locator('.type-choice')[side]().click();
}
const captureClipboard = (page: Page) => page.addInitScript(() => {
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t: string) => { (window as any).copied = t; return Promise.resolve(); } }, configurable: true });
});

test('a result says who you are, how far you lean and who you get along with', async ({ page }) => {
  await page.goto('/#/type');
  await page.getByRole('button', { name: '테스트 시작' }).click();
  await answerAll(page);
  await expect(page.locator('.type-result h2')).toContainText('혼밥 국밥 장인');
  await expect(page.locator('.type-line')).toHaveText('혼자 가도 "맵게 해 주세요"가 자연스러운 사람');
  await expect(page.locator('.type-leans li')).toHaveCount(4);
  await expect(page.locator('.type-leans li').first()).toContainText('100%');
  await expect(page.locator('.type-picks li')).toHaveCount(3);
  await expect(page.locator('.type-related')).toContainText('잘 맞는 유형');
  await expect(page.locator('.type-card img')).toBeVisible();
});

test('a friend opens the link, sees the type, takes the test and gets the match', async ({ page, browser }) => {
  await captureClipboard(page);
  await page.goto('/#/type');
  await page.getByRole('button', { name: '테스트 시작' }).click();
  await answerAll(page);
  await page.getByRole('button', { name: /친구에게 보내고/ }).click();
  await expect(page.locator('.toast')).toContainText('링크를 복사했어요');
  const copied: string = await page.evaluate(() => (window as any).copied);
  const url = copied.split('\n')[1];
  expect(url).toMatch(/\?t=f-SHTA-4444#\/type$/);

  const friend = await (await browser.newContext()).newPage();
  await friend.goto(url);
  await expect(friend.locator('.type-friend h2')).toContainText('혼밥 국밥 장인');
  await expect(friend.locator('.type-match')).toHaveCount(0);
  await friend.getByRole('button', { name: /나도 테스트하고 궁합 보기/ }).click();
  await answerAll(friend, 'last');
  await expect(friend.locator('.type-result h2')).toContainText('브런치 모임장');
  await expect(friend.locator('.type-match-score')).toContainText('45%');
  await expect(friend.locator('.type-match-score')).toBeFocused();
  await expect(friend.locator('.type-match')).toContainText('갈리는 점');
  await friend.reload();
  await expect(friend.locator('.type-match-score')).toContainText('45%');
  await friend.getByRole('button', { name: '친구 결과 닫기' }).click();
  await expect(friend.locator('.type-friend')).toHaveCount(0);
  expect(new URL(friend.url()).search).toBe('');
  await friend.context().close();
});

test('a name in a link shows as text, and a broken link is ignored', async ({ page }) => {
  await page.goto(`/?t=f-SHTA&n=${encodeURIComponent('<b>민지</b>')}#/type`);
  await expect(page.locator('.type-friend-who')).toHaveText('<b>민지</b>님의 음식 유형');
  await expect(page.locator('.type-friend-who b')).toHaveCount(0);
  await page.goto('/?t=f-NOPE#/type');
  await page.reload();
  await expect(page.locator('.type-friend')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '테스트 시작' })).toBeVisible();
});

test('a link with only music opens on music', async ({ page }) => {
  await page.goto('/?t=m-CIRF-1133#/type');
  await expect(page.locator('.type-friend-who')).toHaveText('친구의 음악 유형');
  await expect(page.locator('.type-friend h2')).toContainText('재즈바 단골');
});

test('a saved result from the old eight questions still shows and invites a retake', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nowrecommend-prototype-v1', JSON.stringify({ version: 2, name: '검증', profiles: { food: { selected: [], tags: [], disliked: [] }, music: { selected: [], tags: [], disliked: [] } }, favorites: [], history: [], tasteTypes: { food: { code: 'MLTA', date: '2026-11-03T00:00:00.000Z', source: 'quiz' } } })));
  await page.goto('/#/type');
  await expect(page.locator('.type-result h2')).toContainText('맑은 국물 명상가');
  await expect(page.locator('.type-leans')).toHaveCount(0);
  await expect(page.locator('.type-result')).toContainText('질문이 16개로 늘었으니');
});

for (const width of [320, 390]) test(`the result and a friend's panel fit a ${width} screen`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 });
  await page.goto('/?t=f-SHTA-3432#/type');
  await page.getByRole('button', { name: /나도 테스트하고 궁합 보기/ }).click();
  await answerAll(page);
  await expect(page.locator('.type-match')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
