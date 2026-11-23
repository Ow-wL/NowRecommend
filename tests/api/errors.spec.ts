import { test, expect, type Route } from '@playwright/test';
import { items } from '../../src/data';

// 2026-11-17: an error while drawing the screen shows a way forward instead of a blank page, and reaches the server's log.
const API = 'http://127.0.0.1:5999';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
const fulfill = (route: Route, body: unknown, status = 200) =>
  route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: cors }) : status === 204 ? route.fulfill({ status: 204, headers: cors }) : route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });

test('a screen that fails to draw offers a way out, keeps the data, and is reported once without anything personal', async ({ page }) => {
  const reports: any[] = [];
  await page.route(`${API}/api/catalog**`, route => fulfill(route, { catalogVersion: 'db-test', items }));
  await page.route(`${API}/api/client-errors`, route => { if (route.request().method() === 'POST') reports.push(route.request().postDataJSON()); return fulfill(route, null, 204); });
  await page.addInitScript(() => {
    localStorage.setItem('nowrecommend-prototype-v1', JSON.stringify({ version: 2, name: '검증', profiles: { food: { selected: ['f01'], tags: [], disliked: [] }, music: { selected: [], tags: [], disliked: [] } }, favorites: ['f05'], history: [] }));
    if (!sessionStorage.getItem('crashed-once')) { sessionStorage.setItem('crashed-once', '1'); sessionStorage.setItem('nowrecommend-test-crash', '1'); }
  });
  await page.goto('/#/reset/eyJzdWIiOiJ1MSIsInVzZSI6InJlc2V0In0.c2lnbmF0dXJlLXNpZ25hdHVyZQ');  // an address with something private in it
  await expect(page.getByRole('heading', { name: '화면을 표시하다 문제가 생겼어요' })).toBeVisible();
  await expect(page.getByText('취향과 기록은 이 브라우저에 그대로 있어요.', { exact: false })).toBeVisible();
  await expect.poll(() => reports.length).toBeGreaterThan(0);
  expect(reports.every(r => r.kind === 'render' && r.message === 'test crash' && /^[a-z]+$/.test(r.page) && r.release === 'dev')).toBe(true);
  expect(JSON.stringify(reports)).not.toContain('eyJzdWIi');  // the screen's kind is sent, never the address
  expect(new Set(reports.map(r => r.message)).size).toBe(reports.length);  // each distinct error once
  // The way out works once the cause is gone, and nothing stored was touched.
  await page.evaluate(() => sessionStorage.removeItem('nowrecommend-test-crash'));
  await page.getByRole('button', { name: '홈에서 다시 시작' }).click();
  await expect(page.getByRole('heading', { name: '오늘 뭐 먹지? 한 문장이면 끝.' })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('nowrecommend-prototype-v1')!).favorites)).toEqual(['f05']);
});
