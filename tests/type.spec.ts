import { test, expect, type Page } from '@playwright/test';
import { STATEMENTS, TYPE_DETAILS } from '../src/typeContent';

// Since 2026-11-23: 24 statements on a 5-point scale. 'first' agrees fully with every first-side statement and disagrees
// fully with the others, so each axis reads 100% to its first side; 'last' the reverse.
async function answerAll(page: Page, side: 'first' | 'last' = 'first') {
  const all = [...STATEMENTS.food, ...STATEMENTS.music];
  for (let i = 0; i < 24; i++) {
    const text = (await page.locator('.type-question h2').textContent())!.trim();
    const statement = all.find(s => s.text === text)!;
    const agree = (statement.key === 'a') === (side === 'first');
    await page.getByRole('button', { name: agree ? '매우 그렇다' : '전혀 아니다' }).click();
  }
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
  await expect(page.locator('.type-line')).toHaveText(TYPE_DETAILS.food.SHTA.line);
  await expect(page.locator('.type-pole')).toHaveCount(4);  // what each leaning side means
  for (const part of ['이런 사람이에요', '강점', '이럴 땐 조심', '자주 하는 말', '추천 활용 팁']) await expect(page.locator('.type-result')).toContainText(part);
  await expect(page.locator('.type-list li').first()).toHaveText(TYPE_DETAILS.food.SHTA.traits[0]);
  await expect(page.locator('.type-leans li')).toHaveCount(4);
  await expect(page.locator('.type-leans li').first()).toContainText('100%');
  await expect(page.locator('.type-quick li')).toHaveCount(3);  // strength, caution, picks at a glance
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
  expect(url).toMatch(/\?t=f-SHTA-99999999#\/type$/);

  const friend = await (await browser.newContext()).newPage();
  await friend.goto(url);
  await expect(friend.locator('.type-friend h2')).toContainText('혼밥 국밥 장인');
  await expect(friend.locator('.type-match')).toHaveCount(0);
  await friend.getByRole('button', { name: /나도 테스트하고 궁합 보기/ }).click();
  await answerAll(friend, 'last');
  await expect(friend.locator('.type-result h2')).toContainText('브런치 모임장');
  await expect(friend.locator('.type-match-score')).toContainText('46%');  // a link carries 99 at most, so the opposite of a full lean reads 46
  await expect(friend.locator('.type-match-score')).toBeFocused();
  await expect(friend.locator('.type-match')).toContainText('갈리는 점');
  await friend.reload();
  await expect(friend.locator('.type-match-score')).toContainText('46%');  // a link carries 99 at most, so the opposite of a full lean reads 46
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
  await expect(page.locator('.type-result')).toContainText('문장이 새로 바뀌었으니');
});

for (const width of [320, 390]) test(`the result and a friend's panel fit a ${width} screen`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 });
  await page.goto('/?t=f-SHTA-3432#/type');
  await page.getByRole('button', { name: /나도 테스트하고 궁합 보기/ }).click();
  await answerAll(page);
  await expect(page.locator('.type-match')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('switching food and music halfway keeps each test where it was, and focus follows the question', async ({ page }) => {
  // Review 2026-11-26: the switch threw the answers away, and starting left keyboard focus on the page body.
  await page.goto('/#/type');
  await page.getByRole('button', { name: '테스트 시작' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.type-question h2')).toBeFocused();
  await page.getByRole('button', { name: '그렇다', exact: true }).click();
  await page.getByRole('button', { name: '그렇다', exact: true }).click();
  await expect(page.locator('.type-question small')).toHaveText('3 / 24');
  await page.getByRole('group', { name: '테스트 분야' }).getByRole('button', { name: '음악' }).click();
  await expect(page.locator('.type-question')).toHaveCount(0);  // music has a test of its own, not started
  await page.getByRole('group', { name: '테스트 분야' }).getByRole('button', { name: '음식' }).click();
  await expect(page.locator('.type-question small')).toHaveText('3 / 24');
  await page.getByRole('button', { name: '이전 문장' }).click();
  await expect(page.locator('.type-question h2')).toBeFocused();
});
