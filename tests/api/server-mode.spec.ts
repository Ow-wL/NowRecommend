import { test, expect, type Page, type Route } from '@playwright/test';
import { items, type Item } from '../../src/data';

// Same origin as VITE_API_BASE_URL of the "api" project's dev server (playwright.config.ts).
const API = 'http://127.0.0.1:5999';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
const serverOnly: Item = { ...items[0], id: 'f99', name: '서버 전용 메뉴', description: '서버 카탈로그에만 있는 메뉴.' };
const food = (id: string) => [...items, serverOnly].find(i => i.id === id)!;
const batch = (ids: string[], reason = '서버가 고른 이유') => ({
  results: ids.map(id => ({ item: food(id), tasteReason: reason, contextReason: '이번 상황에 맞아요' })),
  meta: { mode: 'retrieval_only', eligibleCount: 17, newCount: ids.length, catalogVersion: 'db-test', requestId: 'r' },
});
const fulfill = (route: Route, body: unknown, status = 200) =>
  route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: cors }) : route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });

async function seedProfile(page: Page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('nowrecommend-prototype-v1')) localStorage.setItem('nowrecommend-prototype-v1', JSON.stringify({ version: 2, name: '검증',
      profiles: { food: { selected: ['f01', 'f02', 'f03', 'f04', 'f05'], tags: [], disliked: [] }, music: { selected: [], tags: [], disliked: [] } }, favorites: [], history: [] }));
  });
}
async function catalogRoute(page: Page, mode: 'ok' | 'down' = 'ok') {
  await page.route(`${API}/api/catalog**`, route => mode === 'down' ? route.abort() : fulfill(route, { catalogVersion: 'db-test', items: [...items, serverOnly] }));
}
async function requestFood(page: Page) {
  await page.goto('/#/recommend/food');
  await page.getByRole('button', { name: '조건 확인하기' }).click();
  await page.getByRole('button', { name: '추천받기', exact: true }).click();
}
const cardNames = (page: Page) => page.locator('.result-grid h3').allTextContents();

test('recommends from the API server and its catalog', async ({ page }) => {
  await seedProfile(page); await catalogRoute(page);
  const bodies: any[] = [];
  await page.route(`${API}/api/recommend`, route => { if (route.request().method() === 'POST') bodies.push(route.request().postDataJSON()); return fulfill(route, batch(['f99', 'f02', 'f12'])); });
  await requestFood(page);
  await expect(page.locator('.result-grid h3').first()).toHaveText('서버 전용 메뉴');
  await expect(page.getByText('서버가 고른 이유').first()).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ category: 'food', profile: { selected: ['f01', 'f02', 'f03', 'f04', 'f05'] }, seenIds: [], candidateIds: null });
  await expect(page.getByText('기본 추천으로 보여드리고 있어요.')).toHaveCount(0);
});

test('offers a retry and the local fallback when the server fails', async ({ page }) => {
  await seedProfile(page); await catalogRoute(page, 'down');
  let healthy = false;
  await page.route(`${API}/api/recommend`, route => healthy ? fulfill(route, batch(['f12', 'f07', 'f10'])) : fulfill(route, { detail: 'down' }, 503));
  await requestFood(page);
  await expect(page.getByRole('alert')).toContainText('추천 서버에 연결하지 못했어요.');
  await expect(page.getByRole('button', { name: '다시 시도하기' })).toBeVisible();
  await page.getByRole('button', { name: '기본 추천으로 보기' }).click();
  await expect(page.getByText('기본 추천으로 보여드리고 있어요.')).toBeVisible();
  expect(await cardNames(page)).toHaveLength(3); // bundled catalog still works while the catalog API is down
  healthy = true;
  await page.getByRole('button', { name: '다른 추천 보기' }).click();
  await expect(page.locator('.result-grid h3').first()).toHaveText(food('f12').name);
  await expect(page.getByText('기본 추천으로 보여드리고 있어요.')).toHaveCount(0);
});

test('shows progress and sends one request for repeated clicks', async ({ page }) => {
  await seedProfile(page); await catalogRoute(page);
  let posts = 0;
  await page.route(`${API}/api/recommend`, async route => {
    if (route.request().method() === 'POST') posts++;
    await new Promise(resolve => setTimeout(resolve, 800));
    return fulfill(route, batch(['f02', 'f07', 'f12']));
  });
  await page.goto('/#/recommend/food');
  await page.getByRole('button', { name: '조건 확인하기' }).click();
  const submit = page.getByRole('button', { name: '추천받기', exact: true });
  await submit.click();
  const progress = page.getByRole('button', { name: '추천을 고르는 중' });
  await expect(progress).toBeDisabled();
  await progress.click({ force: true });
  await expect(page.locator('.result-grid h3')).toHaveCount(3);
  expect(posts).toBe(1);
});

test('replaces a single card through the server', async ({ page }) => {
  await seedProfile(page); await catalogRoute(page);
  const bodies: any[] = [];
  await page.route(`${API}/api/recommend`, route => {
    const body = route.request().postDataJSON();
    if (body) bodies.push(body);
    return fulfill(route, body?.count === 1 ? batch(['f14'], '교체 이유') : batch(['f02', 'f07', 'f12']));
  });
  await requestFood(page);
  await page.getByRole('button', { name: `${food('f07').name} 한 장 교체` }).click();
  await expect(page.locator('.result-grid h3')).toHaveText([food('f02').name, food('f14').name, food('f12').name]);
  expect(bodies[1]).toMatchObject({ count: 1, pinnedIds: [] });
  expect(bodies[1].excludedIds).toEqual(expect.arrayContaining(['f02', 'f07', 'f12']));
});
