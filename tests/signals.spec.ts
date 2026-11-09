import { test, expect, type Page } from '@playwright/test';
import { items } from '../src/data';

const dish = items.find(i => i.id === 'f01')!;  // 쌀국수, first for a mild dinner when nothing has been chosen
const seed = (page: Page, review?: { rating: string; note: string }, daysAgo = 1) => {
  const date = new Date(Date.now() - daysAgo * 86400000).toISOString();
  const conditions = { tags: [], excluded: [] };
  const result = { item: dish, tasteReason: '', contextReason: '' };
  const entry = { id: 'h1', date, category: 'food', raw: '저녁', conditions, resultIds: [dish.id], rounds: [{ id: 'r1', date, raw: '저녁', conditions, results: [result], feedback: [], excludedIds: [], catalogVersion: 'x' }],
    selected: { result, roundId: 'r1', date }, ...(review ? { review: { ...review, date, itemId: dish.id, roundId: 'r1' } } : {}) };
  return page.addInitScript(v => { if (!localStorage.getItem('nowrecommend-prototype-v1')) localStorage.setItem('nowrecommend-prototype-v1', JSON.stringify(v)); },
    { version: 2, name: '검증', profiles: { food: { selected: [], tags: [], disliked: [] }, music: { selected: [], tags: [], disliked: [] } }, favorites: [], history: [entry] });
};
async function ask(page: Page, text: string) {
  await page.goto('/#/recommend/food');
  await page.getByLabel('지금의 상황').fill(text);
  await page.getByRole('button', { name: /추천받기$/ }).click();
  await expect(page.locator('.result-grid h3').first()).toBeVisible();
}

test('without a past choice the dish comes first, which the tests below rely on', async ({ page }) => {
  await ask(page, '담백한 저녁');
  await expect(page.locator('.result-grid h3').first()).toHaveText(dish.name);
  await expect(page.locator('.taste-hint', { hasText: '뒤로 미뤘어요' })).toHaveCount(0);
});

test('a choice from yesterday moves back and the results say so', async ({ page }) => {
  await seed(page);
  await ask(page, '담백한 저녁');
  await expect(page.locator('.result-grid h3')).not.toContainText([dish.name]);
  await expect(page.locator('.taste-hint', { hasText: '뒤로 미뤘어요' })).toHaveText('최근 7일 동안 고른 1개는 뒤로 미뤘어요.');
});

test('a dish asked for by name is not moved back', async ({ page }) => {
  await seed(page);
  await ask(page, `${dish.name} 담백한 저녁`);
  await expect(page.locator('.taste-hint', { hasText: '뒤로 미뤘어요' })).toHaveCount(0);
});

test('a choice older than the window comes back', async ({ page }) => {
  await seed(page, undefined, 8);
  await ask(page, '담백한 저녁');
  await expect(page.locator('.result-grid h3').first()).toHaveText(dish.name);
});

test('a dish that disappointed stays back after the week is over', async ({ page }) => {
  await seed(page, { rating: 'poor', note: '' }, 20);
  await ask(page, '담백한 저녁');
  await expect(page.locator('.result-grid h3')).not.toContainText([dish.name]);
  await expect(page.locator('.taste-hint', { hasText: '뒤로 미뤘어요' })).toHaveText('아쉬웠던 1개는 뒤로 미뤘어요.');
});

test('the feeling form says what the rating does', async ({ page }) => {
  await ask(page, '담백한 저녁');
  await page.getByRole('button', { name: `${dish.name} 오늘은 이걸로` }).click();
  await expect(page.locator('.review-form')).toContainText('만족과 아쉬움은 다음 추천에 반영돼요. 메모는 기록용이에요.');
});

test('each card says how many conditions it answers and on what basis', async ({ page }) => {
  await ask(page, '담백한 저녁');
  const line = page.locator('.result-grid .card-evidence').first();
  await expect(line).toHaveText('조건 2개 중 2개 확인 · 등록 정보 기준');
  await expect(line).toBeVisible();
});
