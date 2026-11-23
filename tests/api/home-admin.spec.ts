import { test, expect, type Route } from '@playwright/test';
import { items } from '../../src/data';

// The home's one promise and the admin page (2026-11-23), against a fake server: a sentence on the home screen asks for
// food at once; an admin sees 관리 in the menu and a dashboard drawn from the daily counts; a browser counts its visit once.
const API = 'http://127.0.0.1:5999';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE' };
const fulfill = (route: Route, body: unknown, status = 200) =>
  route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: cors }) : route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
const admin = { id: 'a1', email: 'op@example.com', name: '운영자', createdAt: null, isAdmin: true };

function board(days: number) {
  const out = [];
  for (let n = days - 1; n >= 0; n--) {
    const d = new Date(Date.UTC(2026, 10, 23) - n * 86400000).toISOString().slice(0, 10), k = days - n;
    out.push({ day: d, counts: { visit: 3 + (k * 7) % 11, 'recommend:food': 2 + (k * 5) % 9, 'recommend:music': 1 + (k * 3) % 6, pair: k % 3, 'type:food': k % 2, 'type:music': (k + 1) % 2, youtube: k % 4, signup: k % 5 === 0 ? 1 : 0, verify: k % 5 === 0 ? 1 : 0, login: k % 3, feedback: k % 7 === 0 ? 1 : 0, report: 0 } });
  }
  return { days: out, totals: { accounts: 4, confirmedAccounts: 3, feedback: 5, openReports: 1 } };
}

test('a sentence on the home screen asks for food at once', async ({ page }) => {
  const asked: any[] = [], visits: any[] = [];
  await page.route(`${API}/api/catalog**`, route => fulfill(route, { catalogVersion: 'db-test', items }));
  await page.route(`${API}/api/stats`, route => { if (route.request().method() === 'POST') visits.push(route.request().postDataJSON()); return route.request().method() === 'OPTIONS' ? fulfill(route, {}) : route.fulfill({ status: 204, headers: cors }); });
  await page.route(`${API}/api/parse`, route => fulfill(route, { conditions: null, source: 'local' }));
  await page.route(`${API}/api/recommend`, route => { if (route.request().method() === 'POST') asked.push(route.request().postDataJSON()); return fulfill(route, { results: [], meta: { engine: 'catalog' } }); });
  await page.goto('/#/home');
  await expect(page.getByRole('heading', { name: /오늘 뭐 먹지\?/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/home-promise.png', fullPage: true });
  await page.getByLabel('지금 상황').fill('비 오는 저녁, 혼자 맵지 않게');
  await page.getByRole('button', { name: /메뉴 골라 줘/ }).click();
  await expect.poll(() => asked.length).toBeGreaterThan(0);
  expect(asked[0].category).toBe('food');
  await page.reload();
  await page.waitForTimeout(500);
  expect(visits.filter(v => v.event === 'visit')).toHaveLength(1);  // once a day, however often the page opens
});

test('an admin finds 관리 in the menu and reads the dashboard', async ({ page }) => {
  await page.context().addInitScript(account => { localStorage.setItem('nowrecommend-auth-v1', JSON.stringify(account)); }, { token: 'tok', user: admin });
  await page.route(`${API}/api/catalog**`, route => fulfill(route, { catalogVersion: 'db-test', items }));
  await page.route(`${API}/api/auth/me`, route => fulfill(route, { user: admin, hasStore: false, storeUpdatedAt: null, storeVersion: 0 }));
  await page.route(`${API}/api/me/store`, route => fulfill(route, { store: null, updatedAt: null, version: 0 }));
  await page.route(`${API}/api/stats`, route => route.request().method() === 'OPTIONS' ? fulfill(route, {}) : route.fulfill({ status: 204, headers: cors }));
  await page.route(`${API}/api/admin/stats**`, route => fulfill(route, board(Number(new URL(route.request().url()).searchParams.get('days')))));
  await page.route(`${API}/api/admin/reports**`, route => fulfill(route, { reports: [], counts: { open: 0, resolved: 0, dismissed: 0 } }));
  await page.route(`${API}/api/admin/feedback**`, route => fulfill(route, { feedback: [], more: false }));
  await page.goto('/#/home');
  await page.getByRole('navigation', { name: '주요 메뉴' }).getByRole('button', { name: '관리' }).click();
  await expect(page.getByRole('heading', { name: '이용 통계' })).toBeVisible();
  await expect(page.locator('.stats-tile').first()).toContainText('오늘 방문');
  await page.screenshot({ path: 'test-results/admin-stats.png', fullPage: true });
  await page.getByRole('button', { name: '7일' }).click();
  await expect(page.locator('.stats-tile').nth(1)).toContainText('7일 방문');
  await page.getByRole('tab', { name: '의견' }).click();
  await expect(page.getByText('받은 의견이 없어요.')).toBeVisible();
});

test('someone who is not an admin has no 관리 in the menu', async ({ page }) => {
  await page.context().addInitScript(account => { localStorage.setItem('nowrecommend-auth-v1', JSON.stringify(account)); }, { token: 'tok', user: { ...admin, isAdmin: undefined } });
  await page.route(`${API}/api/catalog**`, route => fulfill(route, { catalogVersion: 'db-test', items }));
  await page.route(`${API}/api/auth/me`, route => fulfill(route, { user: { ...admin, isAdmin: undefined }, hasStore: false, storeUpdatedAt: null, storeVersion: 0 }));
  await page.route(`${API}/api/me/store`, route => fulfill(route, { store: null, updatedAt: null, version: 0 }));
  await page.route(`${API}/api/stats`, route => route.request().method() === 'OPTIONS' ? fulfill(route, {}) : route.fulfill({ status: 204, headers: cors }));
  await page.goto('/#/home');
  await expect(page.getByRole('navigation', { name: '주요 메뉴' }).getByRole('button', { name: '홈' })).toHaveCount(0);  // 홈 is the logo, the menu has 음식…
  await expect(page.getByRole('navigation', { name: '주요 메뉴' }).getByRole('button', { name: '관리' })).toHaveCount(0);
});
