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
  await page.route(`${API}/api/admin/feedback**`, route => fulfill(route, { feedback: [{ id: 'f1', kind: 'idea', message: '아주 긴 의견 '.repeat(20), contact: null, page: 'type', appVersion: '', createdAt: '2026-11-24T09:00:00Z' }], more: false }));
  const music = { requests: 3, ai: 2, fallback: 1, errors: 0, latencyP50: 3100, latencyP95: 4200, issues: { store_missing: 2 },
    topItems: [{ id: 'm1', name: '입춘', artist: '한로로', count: 2 }], topTags: [{ tag: '차분함', count: 2 }], topExcluded: [] };
  await page.route(`${API}/api/admin/insights**`, route => fulfill(route, { days: Number(new URL(route.request().url()).searchParams.get('days')), recommendations: { music },
    hours: Array.from({ length: 24 }, (_, h) => h === 18 ? 3 : 0), accounts: { total: 2, confirmed: 2, admins: 1, newInPeriod: 1, activeWeek: 1, withSavedData: 1 },
    access: { addressesToday: 2, addressesInPeriod: 3, busiest: [{ address: '203.0.113.7', count: 4, last: '2026-11-24T09:00:00Z' }] },
    ai: { usedToday: 12, dailyLimit: 3000 }, feedbackKinds: { idea: 1 }, reportStatus: {} }));
  await page.route(`${API}/api/admin/access**`, route => fulfill(route, { entries: [{ id: 2, at: '2026-11-24T09:00:00Z', address: '203.0.113.7', event: 'login' }, { id: 1, at: '2026-11-24T08:50:00Z', address: '198.51.100.23', event: 'visit' }], more: false }));
  await page.goto('/#/home');
  await page.getByRole('navigation', { name: '주요 메뉴' }).getByRole('button', { name: '관리' }).click();
  await expect(page.getByRole('heading', { name: '이용 통계' })).toBeVisible();
  await expect(page.locator('.stats-tile').first()).toContainText('오늘 방문');
  await page.screenshot({ path: 'test-results/admin-stats.png', fullPage: true });
  await page.getByRole('group', { name: '기간', exact: true }).getByRole('button', { name: '7일' }).click();
  await expect(page.locator('.stats-tile').nth(1)).toContainText('7일 방문');
  // The details below the counts (2026-11-24): what was recommended most, how the AI did, the busiest addresses.
  const details = page.locator('.admin-insights');
  await expect(details).toContainText('입춘');
  await expect(details).toContainText('스토어에 없는 곡');
  await expect(details).toContainText('203.0.113.7');
  await page.getByRole('tab', { name: '접속 기록' }).click();
  await expect(page.locator('.access-table tbody tr')).toHaveCount(2);
  await page.getByRole('button', { name: '203.0.113.7 기록만 보기' }).click();
  await expect(page.locator('.access-table tbody tr')).toHaveCount(1);
  await page.getByRole('tab', { name: '의견' }).click();
  // A feedback card has no picture: its text uses the whole width (it was squeezed into the 84px picture column).
  const note = page.locator('.admin-feedback .report-note').first();
  const [noteBox, cardBox] = [await note.boundingBox(), await page.locator('.admin-feedback .report-card').first().boundingBox()];
  expect(noteBox!.width).toBeGreaterThan(cardBox!.width * 0.8);
  await expect(page.locator('.admin-feedback small').first()).toContainText('취향 유형 화면');
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
