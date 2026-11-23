import { test, expect } from '@playwright/test';
import { STATEMENTS } from '../src/typeContent';

// 2026-11-23: what a choice does is shown as three steps, on the results for someone who has chosen little so far and on
// the completion page, where the rating is the last step.
test('the results and the completion page show how a choice shapes the next recommendation', async ({ page }) => {
  await page.goto('/#/home');
  await page.getByLabel('지금 상황').fill('혼자 먹을 따뜻한 저녁');
  await page.getByRole('button', { name: /메뉴 골라 줘/ }).click();
  const loop = page.locator('.learn-loop');
  await expect(loop).toBeVisible();
  await expect(loop.locator('li.now')).toContainText('골라요');
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'test-results/loop-results.png' });
  await page.locator('.result-grid .select-button').first().click();
  await expect(page.getByRole('heading', { name: '선택을 기록했어요' })).toBeVisible();
  await expect(loop.locator('li.done')).toHaveCount(2);
  await expect(loop.locator('li.now')).toContainText('다음이 달라져요');
  await expect(loop.locator('p')).toContainText('7일 동안 조금 뒤로 미뤄');
  await page.waitForTimeout(900);  // the page fades in
  await page.screenshot({ path: 'test-results/loop-complete.png', fullPage: true });
  await page.getByRole('radio', { name: '만족' }).check();
  await page.getByRole('button', { name: '만족도·메모 저장' }).click();
  await expect(loop.locator('li.done')).toHaveCount(3);
  await expect(loop.locator('p')).toContainText('비슷한 특징을 더 챙겨요');
});

for (const category of ['food', 'music'] as const) test(`a ${category} type result opens with a drawing and a short summary, the long reading folded`, async ({ page }) => {
  await page.goto('/#/type');
  await page.getByRole('navigation', { name: '주요 메뉴' }).getByRole('button', { name: '취향 유형' }).waitFor();
  if (category === 'music') await page.getByRole('button', { name: '음악', exact: true }).last().click();
  await page.getByRole('button', { name: '테스트 시작' }).click();
  for (let i = 0; i < 24; i++) {
    const text = (await page.locator('.type-question h2').textContent())!.trim();
    const s = STATEMENTS[category].find(x => x.text === text)!;
    await page.getByRole('button', { name: s.axis % 2 ? (s.key === 'a' ? '그렇다' : '아니다') : (s.key === 'b' ? '매우 그렇다' : '전혀 아니다'), exact: true }).click();
  }
  await expect(page.locator('.type-hero svg.type-art')).toBeVisible();
  await expect(page.locator('.type-glance li')).toHaveCount(4);
  await expect(page.locator('.type-quick li')).toHaveCount(3);
  await expect(page.locator('details.type-more')).not.toHaveAttribute('open', '');
  await page.screenshot({ path: `test-results/type-${category}.png`, fullPage: true });
});
