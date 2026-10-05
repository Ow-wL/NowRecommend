import { test, expect, type Page } from '@playwright/test';

async function onboard(page: Page, category: 'food' | 'music' = 'food') {
  await page.getByRole('button', { name: category === 'food' ? '음식 추천' : '음악 추천', exact: true }).click();
  const choices = page.locator('.selection-card');
  for (let i = 0; i < 5; i++) await choices.nth(i).click();
  await page.getByRole('button', { name: '취향 요약 확인' }).click();
  await page.getByRole('button', { name: '확인하고 저장' }).click();
}

test('food journey, favorites, history and browser persistence', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '오늘도, 나에게 맞는 선택.' })).toBeVisible();
  await page.getByRole('button', { name: '음식 추천', exact: true }).click();
  await expect(page.getByRole('button', { name: '취향 요약 확인' })).toBeDisabled();
  const choices = page.locator('.selection-card');
  for (let i = 0; i < 5; i++) await choices.nth(i).click();
  await page.getByRole('button', { name: '취향 요약 확인' }).click();
  await page.getByRole('button', { name: '확인하고 저장' }).click();
  await page.getByLabel('지금의 상황').fill('혼자 먹을 안 매운 저녁, 밀 제외');
  await page.getByRole('button', { name: '조건 확인하기' }).click();
  await expect(page.getByRole('button', { name: '매콤함', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '추천받기', exact: true }).click();
  await expect(page.locator('.result-grid .item-card')).toHaveCount(3);
  await expect(page.locator('.result-grid')).not.toContainText('김치찌개');
  await page.locator('.result-grid .save-button').first().click();
  const chosenName = await page.locator('.result-grid h3').first().textContent();
  await page.getByRole('button', { name: '즐겨찾기', exact: false }).first().click();
  await expect(page.locator('.collection-grid .item-card')).toHaveCount(1);
  await page.reload();
  await page.getByRole('button', { name: '즐겨찾기', exact: false }).first().click();
  await expect(page.locator('.collection-grid')).toContainText(chosenName!);
  await page.getByRole('button', { name: '추천 기록', exact: true }).click();
  await expect(page.locator('.history-row')).toHaveCount(1);
  await page.locator('.history-title').click();
  await expect(page.getByRole('dialog')).toContainText('밀 제외');
  await page.getByRole('button', { name: '같은 조건으로 다시 추천' }).click();
  await expect(page.getByRole('heading', { name: '지금, 어떤 한 끼가 필요하세요?' })).toBeVisible();
});

test('session exclusion clears while long feedback persists and can be reversed', async ({ page }) => {
  await page.goto('/'); await onboard(page);
  await page.getByLabel('지금의 상황').fill('담백한 저녁');
  await page.getByRole('button', { name: '조건 확인하기' }).click();
  await page.getByRole('button', { name: '추천받기', exact: true }).click();
  const first = await page.locator('.result-grid h3').first().textContent();
  await page.locator('.feedback-button').first().click();
  await page.getByRole('button', { name: '오늘만 제외', exact: false }).click();
  await expect(page.locator('.result-grid')).not.toContainText(first!);
  await page.getByRole('button', { name: '되돌리기' }).click();
  await expect(page.locator('.result-grid')).toContainText(first!);
  await page.locator('.feedback-button').first().click();
  await page.getByRole('button', { name: '오늘만 제외', exact: false }).click();
  await page.getByRole('button', { name: '새로운 상황으로 추천받기' }).click();
  await page.getByLabel('지금의 상황').fill('담백한 저녁');
  await page.getByRole('button', { name: '조건 확인하기' }).click();
  await page.getByRole('button', { name: '추천받기', exact: true }).click();
  await expect(page.locator('.result-grid')).toContainText(first!);
  await page.locator('.feedback-button').first().click();
  await page.getByRole('button', { name: '원래 내 취향이 아님', exact: false }).click();
  await expect(page.locator('.result-grid')).not.toContainText(first!);
  await page.getByRole('button', { name: '새로운 상황으로 추천받기' }).click();
  await page.getByLabel('지금의 상황').fill('담백한 저녁');
  await page.getByRole('button', { name: '조건 확인하기' }).click();
  await page.getByRole('button', { name: '추천받기', exact: true }).click();
  await expect(page.locator('.result-grid')).not.toContainText(first!);
  await page.reload();
  await page.getByRole('button', { name: '내 취향', exact: true }).click();
  await expect(page.getByRole('button', { name: `${first} 비선호 해제` })).toBeVisible();
  await page.getByRole('button', { name: `${first} 비선호 해제` }).click();
  await expect(page.getByRole('button', { name: `${first} 비선호 해제` })).toHaveCount(0);
});

test('independent music onboarding produces five songs and external links', async ({ page }) => {
  await page.goto('/'); await onboard(page, 'music');
  await page.getByLabel('지금의 상황').fill('과제할 때 보컬 없는 차분한 연주곡');
  await page.getByRole('button', { name: '조건 확인하기' }).click();
  await page.getByRole('button', { name: '추천받기', exact: true }).click();
  await expect(page.locator('.result-grid .item-card')).toHaveCount(5);
  await expect(page.locator('.result-grid')).not.toContainText('아이유');
  const links = page.locator('.result-grid a'); await expect(links).toHaveCount(5);
  await expect(links.first()).toHaveAttribute('target', '_blank');
  await page.getByRole('button', { name: '음식 추천', exact: true }).click();
  await expect(page.getByRole('heading', { name: '평소 좋아하는 음식을 골라주세요.' })).toBeVisible();
});

test('request failure allows retry and manual fallback', async ({ page }) => {
  await page.goto('/'); await onboard(page);
  await page.getByRole('button', { name: '조건 확인하기' }).click();
  await page.locator('.help-link').click();
  await page.getByRole('button', { name: '다음 추천 실패 체험하기' }).click();
  await page.getByRole('button', { name: '추천받기', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: '직접 선택한 조건으로 계속' }).click();
  await expect(page.locator('.result-grid .item-card')).toHaveCount(3);
  await page.getByRole('button', { name: '조건 수정', exact: true }).click();
  await page.locator('.help-link').click();
  await page.getByRole('button', { name: '다음 추천 실패 체험하기' }).click();
  await page.getByRole('button', { name: '추천받기', exact: true }).click();
  await page.getByRole('button', { name: '다시 시도하기' }).click();
  await expect(page.locator('.result-grid .item-card')).toHaveCount(3);
});

test('no eligible candidates, empty collections, and confirmed deletion', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '즐겨찾기', exact: true }).click();
  await expect(page.locator('.empty-state')).toBeVisible();
  await onboard(page);
  // Hard exclusions and budget leave one candidate, which can then be temporarily excluded.
  const tags = ['매콤함','소고기','닭고기','생선','밀','유제품','달걀','콩'];
  for (const tag of tags) await page.locator('.chip.exclude').filter({ hasText: new RegExp(`^${tag}$`) }).click();
  await page.getByLabel('참고 가격대').selectOption('10000');
  // The vegetable curry remains eligible; verify limited results and visible explanation.
  await page.getByRole('button', { name: '조건 확인하기' }).click();
  await page.getByRole('button', { name: '추천받기', exact: true }).click();
  await expect(page.locator('.notice.warning')).toBeVisible();
  await expect(page.locator('.result-grid .item-card')).toHaveCount(1);
  await page.locator('.feedback-button').click();
  await page.getByRole('button', { name: '오늘만 제외', exact: false }).click();
  await expect(page.locator('.result-grid .item-card')).toHaveCount(0);
  await expect(page.locator('.notice.warning')).toContainText('지금 조건에 맞는 후보가 없어요.');
  await page.getByRole('button', { name: '추천 기록', exact: true }).click();
  await page.getByRole('button', { name: /기록 삭제/ }).click();
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.locator('.history-row')).toHaveCount(1);
  await page.getByRole('button', { name: /기록 삭제/ }).click();
  await page.getByRole('button', { name: '삭제하기', exact: true }).click();
  await expect(page.locator('.history-row')).toHaveCount(0);
});

test('mobile navigation and layout have no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await page.getByRole('button', { name: '메뉴 열기' }).click();
  await page.getByRole('button', { name: '음식 추천', exact: true }).click();
  await expect(page.getByRole('heading', { name: '평소 좋아하는 음식을 골라주세요.' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/mobile-onboarding.png', fullPage: true, animations: 'disabled' });
});

test('desktop visual preview and no client errors', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await page.screenshot({ path: 'artifacts/home-desktop.png', fullPage: true, animations: 'disabled' });
  await onboard(page); await page.getByLabel('지금의 상황').fill('혼자 먹을 담백한 저녁');
  await page.getByRole('button', { name: '조건 확인하기' }).click();
  await page.getByRole('button', { name: '추천받기', exact: true }).click();
  await expect(page.locator('.result-grid .item-card')).toHaveCount(3);
  const dismiss = page.getByRole('button', { name: '알림 닫기' });
  if (await dismiss.isVisible()) await dismiss.click();
  await page.screenshot({ path: 'artifacts/results-desktop.png', fullPage: true, animations: 'disabled' });
  expect(errors).toEqual([]);
});
