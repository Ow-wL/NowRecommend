import type { Page } from '@playwright/test';

// Taste setup is one screen: pick five, then save.
export async function onboard(page: Page, category: 'food' | 'music' = 'food') {
  await page.getByRole('button', { name: category === 'food' ? '음식 추천' : '음악 추천', exact: true }).click();
  await pickFive(page);
  await page.getByRole('button', { name: '저장하고 시작' }).click();
}
export async function pickFive(page: Page) {
  const choices = page.locator('.selection-card');
  for (let i = 0; i < 5; i++) await choices.nth(i).click();
}

// Hand-picked conditions (tags, exclusions, budget, presets) are folded under "조건 직접 고르기".
export async function openConditions(page: Page) {
  const panel = page.locator('details.more-conditions');
  if (!(await panel.evaluate(d => (d as HTMLDetailsElement).open))) await panel.locator('summary').click();
}

// Card tools (detail, pin, replace, compare, exclude) sit behind each card's "더보기" menu.
export async function openCardMenu(page: Page, item: string) {
  await page.getByRole('button', { name: `${item} 더보기`, exact: true }).click();
}
export async function cardTool(page: Page, item: string, tool: '상세 보기' | '이번 요청 고정' | '한 장 교체' | '비교 항목') {
  await openCardMenu(page, item);
  await page.getByRole('button', { name: `${item} ${tool}`, exact: true }).click();
}
export async function excludeCard(page: Page, index = 0) {
  await page.locator('.result-grid .more-toggle').nth(index).click();
  await page.locator('.more-menu .feedback-button').click();
}
