import { test, expect } from '@playwright/test';

for (const width of [390, 1440]) {
  test(`light home and both result layouts at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto('/');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(242, 244, 246)');
    for (const name of ['음식 추천받기', '음악 추천받기']) {
      const box = await page.getByRole('button', { name: new RegExp(name) }).boundingBox();
      expect(box!.y + box!.height).toBeLessThan(844);
    }
    await page.screenshot({ path: `artifacts/light-home-${width}-default.png`, fullPage: true });
    for (const category of ['food', 'music']) {
      await page.getByRole('button', { name: category === 'food' ? '음식 추천' : '음악 추천', exact: true }).click();
      for (let i = 0; i < 5; i++) await page.locator('.selection-card').nth(i).click();
      await page.getByRole('button',{name:'저장하고 시작'}).click();
      await page.getByLabel('지금의 상황').fill(category === 'food' ? '담백한 저녁' : '과제할 때 차분한 연주곡');
      await page.getByRole('button', { name: '추천받기', exact: true }).click();
      await expect(page.locator('.result-grid .item-card')).toHaveCount(category === 'food' ? 3 : 5);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const cards = await page.locator('.result-grid .item-card').evaluateAll(nodes => nodes.map(n => { const b = n.getBoundingClientRect(); return { x: b.x, y: b.y }; }));
      if (category === 'food' && width === 1440) expect(new Set(cards.map(b => b.y)).size).toBe(1);
      else expect(new Set(cards.map(b => b.x)).size).toBe(1);
      const dismiss = page.getByRole('button', { name: '알림 닫기' });
      if (await dismiss.isVisible()) await dismiss.click();
      await page.screenshot({ path: `artifacts/light-${category}-${width}-results.png`, fullPage: true });
    }
  });
}
