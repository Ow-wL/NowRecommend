import { test, expect, type Page, type Route } from '@playwright/test';
import { items } from '../../src/data';

// Strict review of 2026-10-27: a music genre filter emptied the food taste screen. The catalog response is mocked
// (route interception) so the music list is long enough to show the search and filters; no real server is called.
const API = 'http://127.0.0.1:5999';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
const longCatalog = [...items, ...Array.from({ length: 15 }, (_, n) => ({ ...items.find(i => i.id === 'm06')!, id: `review-music-${n}`, name: `검수용 연주곡 ${n}` }))];
const fulfill = (route: Route, body: unknown) =>
  route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: cors }) : route.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify(body) });

async function openMusicWithFilter(page: Page) {
  await page.route(`${API}/api/catalog**`, route => fulfill(route, { catalogVersion: 'review-filter', items: longCatalog }));
  await page.goto('/');
  await page.getByRole('button', { name: '음악 추천', exact: true }).click();
  const filters = page.getByRole('group', { name: '장르·분위기로 좁히기' });
  await filters.getByRole('button', { name: '재즈', exact: true }).click();
  await page.getByLabel('취향 항목 검색').fill('Miles');
  await expect(page.locator('.selection-card')).toHaveCount(1);
  return filters;
}

test('music browsing state never leaks into food, through the menu or the back button', async ({ page }) => {
  await openMusicWithFilter(page);
  await page.getByRole('button', { name: '음식 추천', exact: true }).click();
  await expect(page.getByRole('heading', { name: '평소 좋아하는 음식을 골라주세요.' })).toBeVisible();
  await expect(page.locator('.selection-card')).toHaveCount(16);
  await page.screenshot({ path: 'artifacts/review-fix-filter.png', fullPage: true });
  await page.goBack();
  await expect(page.getByRole('heading', { name: '평소 좋아하는 음악을 골라주세요.' })).toBeVisible();
  await expect(page.getByRole('group', { name: '장르·분위기로 좁히기' }).getByRole('button', { name: '전체', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('취향 항목 검색')).toHaveValue('');
  await expect(page.locator('.selection-card')).toHaveCount(30);
});

test('food to music and taste editing start with a clean list too', async ({ page }) => {
  await openMusicWithFilter(page);
  await page.getByLabel('선택한 항목만 보기').check();
  await page.getByRole('button', { name: '음식 추천', exact: true }).click();
  await expect(page.locator('.selection-card')).toHaveCount(16);
  await page.getByRole('button', { name: '음악 추천', exact: true }).click();
  await expect(page.locator('.selection-card')).toHaveCount(30);
  await expect(page.getByLabel('선택한 항목만 보기')).not.toBeChecked();
  await page.getByRole('button', { name: '취향 없이 바로 추천받기' }).click();
  await page.getByRole('button', { name: '내 취향', exact: true }).first().click();
  await page.getByRole('button', { name: '등록하기' }).first().click(); // food taste editing
  await expect(page.locator('.selection-card')).toHaveCount(16);
});
