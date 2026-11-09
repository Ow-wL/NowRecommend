import { test, expect } from '@playwright/test';

test('picks a dish and a song together, explains the match and records the choice', async ({ page }) => {
  await page.goto('/#/home');
  await page.locator('.door.pair').click();
  await page.getByLabel('지금의 상황').fill('친구랑 매콤하게 신나는 노래');
  await page.getByRole('button', { name: /같이 추천받기/ }).click();
  await expect(page.locator('h1')).toHaveText('친구랑 매콤하게 신나는 노래');
  await expect(page.locator('h1')).toBeFocused();
  const cards = page.locator('.pair-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.first().locator('.pair-why p')).not.toBeEmpty();

  // Another song keeps the dish, and the set survives a trip to the record.
  const dish = await cards.first().locator('h2').first().textContent();
  const song = await cards.first().locator('h2').nth(1).textContent();
  await cards.first().getByRole('button', { name: /다른 곡/ }).click();
  await expect(cards.first().locator('h2').first()).toHaveText(dish!);
  await expect(cards.first().locator('h2').nth(1)).not.toHaveText(song!);

  const picked = await cards.first().locator('h2').nth(1).textContent();
  await cards.first().getByRole('button', { name: /조합 기록/ }).click();
  await expect(page.locator('.toast')).toContainText('추천 기록에 남겼어요');
  await expect(cards.first().getByRole('button', { name: /조합 기록/ })).toBeDisabled();

  await page.reload();
  await expect(page.locator('.pair-card')).toHaveCount(3);
  await expect(page.locator('.pair-card').first().locator('h2').nth(1)).toHaveText(picked!);
  await page.goto('/#/history');
  await expect(page.locator('#main-content')).toContainText(dish!);
  await expect(page.locator('#main-content')).toContainText(picked!);
});

test('an empty request follows the hour, and the undo removes both records', async ({ page }) => {
  await page.goto('/#/pair');
  await page.getByRole('button', { name: /같이 추천받기/ }).click();
  await expect(page.locator('.pair-card')).toHaveCount(3);
  await page.locator('.pair-card').first().getByRole('button', { name: /조합 기록/ }).click();
  await page.locator('.toast').getByRole('button', { name: '되돌리기' }).click();
  const history = await page.evaluate(() => JSON.parse(localStorage.getItem('nowrecommend-prototype-v1')!).history);
  expect(history).toEqual([]);
});

for (const width of [320, 390, 1280]) test(`the home and the pairs fit a ${width} screen`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 });
  await page.goto('/#/home');
  await expect(page.locator('.door')).toHaveCount(3);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/#/pair');
  await page.getByRole('button', { name: /같이 추천받기/ }).click();
  await expect(page.locator('.pair-card')).toHaveCount(3);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
