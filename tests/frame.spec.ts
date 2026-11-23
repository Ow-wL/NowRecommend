import { test, expect } from '@playwright/test';

// 2026-11-23: inside another site's frame the app does not draw itself (no frame-ancestors on a static host).
test('the app framed by another page shows only a way to open it on its own', async ({ page, baseURL }) => {
  await page.setContent(`<iframe src="${baseURL}/#/home" style="width:800px;height:600px"></iframe>`);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByText('지금 추천은 다른 사이트 안에서 열 수 없어요.')).toBeVisible();
  await expect(frame.getByRole('link', { name: '새 창에서 열기' })).toHaveAttribute('target', '_blank');
  await expect(frame.locator('.app-shell')).toHaveCount(0);
});
