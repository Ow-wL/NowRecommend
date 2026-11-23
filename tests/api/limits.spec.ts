import { test, expect, type Page, type Route } from '@playwright/test';
import { items } from '../../src/data';

// 2026-11-17: the AI lab is an admin tool, and a daily limit is told as a limit (server/app/budget.py).
const API = 'http://127.0.0.1:5999';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE' };
const fulfill = (route: Route, body: unknown, status = 200) =>
  route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: cors }) : route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
const batch = (ids: string[], meta: object = {}) => ({
  results: ids.map(id => ({ item: items.find(i => i.id === id)!, tasteReason: '목록에서 고른 이유', contextReason: '이번 상황에 맞아요' })),
  meta: { mode: 'retrieval_only', eligibleCount: 17, newCount: ids.length, catalogVersion: 'db-test', requestId: 'r', ...meta },
});
const member = { id: 'u1', email: 'lee@example.com', name: '주형', createdAt: null };

async function setup(page: Page, account?: { token: string; user: object }) {
  await page.addInitScript(signedIn => {
    if (!localStorage.getItem('nowrecommend-prototype-v1')) localStorage.setItem('nowrecommend-prototype-v1', JSON.stringify({ version: 2, name: '검증',
      profiles: { food: { selected: ['f01', 'f02', 'f03', 'f04', 'f05'], tags: [], disliked: [] }, music: { selected: [], tags: [], disliked: [] } }, favorites: [], history: [] }));
    if (signedIn) localStorage.setItem('nowrecommend-auth-v1', JSON.stringify(signedIn));
  }, account ?? null);
  await page.route('https://itunes.apple.com/**', route => route.abort());
  await page.route(`${API}/api/catalog**`, route => fulfill(route, { catalogVersion: 'db-test', items }));
  await page.route(`${API}/api/auth/me`, route => fulfill(route, { user: account?.user ?? member, hasStore: false, storeUpdatedAt: null, storeVersion: 0 }));
  let version = 0;
  await page.route(`${API}/api/me/store`, route => route.request().method() === 'PUT' ? fulfill(route, { updatedAt: '2026-11-17T00:00:00Z', bytes: 1, version: ++version }) : fulfill(route, { store: null, updatedAt: null, version }));
}
async function requestFood(page: Page) {
  await page.goto('/#/recommend/food');
  await page.getByRole('button', { name: /추천받기$/ }).click();
}

test('a guest past the daily allowance is told it is a limit, and that signing in gives more', async ({ page }) => {
  await setup(page);
  const sent: (string | undefined)[] = [];
  await page.route(`${API}/api/recommend`, route => { if (route.request().method() === 'POST') sent.push(route.request().headers()['authorization']);
    return fulfill(route, batch(['f02', 'f12', 'f09'], { engine: 'catalog', engineWanted: 'ai', ai: 'off', limit: 'guest' })); });
  await requestFood(page);
  await expect(page.getByText('오늘 받을 수 있는 AI 추천을 모두 썼어요.')).toBeVisible();
  await expect(page.getByText('로그인하면 하루에 더 많이 받을 수 있어요.', { exact: false })).toBeVisible();
  await expect(page.getByText('내일 다시 AI가 골라요.', { exact: false })).toBeVisible();
  // Not a fault: the "AI is not set up" and "try again" lines are not shown, and the cards are there.
  await expect(page.getByText('이 서버에는 AI가 설정되지 않았어요.')).toHaveCount(0);
  await expect(page.locator('.result-grid h3')).toHaveCount(3);
  expect(sent).toEqual([undefined]);  // a guest sends no token
  await page.reload();  // the notice belongs to the restored cards
  await expect(page.getByText('오늘 받을 수 있는 AI 추천을 모두 썼어요.')).toBeVisible();
});

test('a signed-in person is counted as themselves, and a spent service budget reads differently', async ({ page }) => {
  await setup(page, { token: 'tok-member', user: member });
  const sent: (string | undefined)[] = [];
  let limit = 'member';
  await page.route(`${API}/api/recommend`, route => { if (route.request().method() === 'POST') sent.push(route.request().headers()['authorization']);
    return fulfill(route, batch(['f02', 'f12', 'f09'], { engine: 'catalog', engineWanted: 'ai', ai: limit === 'service' ? 'failed' : 'off', limit })); });
  await requestFood(page);
  await expect(page.getByText('오늘 받을 수 있는 AI 추천을 모두 썼어요.')).toBeVisible();
  await expect(page.getByText('로그인하면', { exact: false })).toHaveCount(0);  // already signed in
  expect(sent).toEqual(['Bearer tok-member']);
  limit = 'service';
  await page.getByRole('button', { name: '같은 조건으로 다시 추천' }).click();
  await expect(page.getByText('오늘 준비한 AI 추천이 모두 소진됐어요.')).toBeVisible();
});

test('the AI lab is not offered to guests or members, and its address leads home', async ({ page }) => {
  await setup(page, { token: 'tok-member', user: member });
  await page.goto('/#/home');
  await expect(page.getByRole('button', { name: '내 계정' })).toBeVisible();
  await expect(page.getByRole('button', { name: /AI 실험실/ })).toHaveCount(0);
  await page.goto('/#/taste');
  await expect(page.getByRole('button', { name: /취향 유형 테스트/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /AI 실험실/ })).toHaveCount(0);
  await page.goto('/#/lab');
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.getByRole('heading', { name: '오늘 뭐 먹지? 한 문장이면 끝.' })).toBeVisible();
});

test('an admin account sees the lab and sends its token with the lab’s requests', async ({ page }) => {
  await setup(page, { token: 'tok-admin', user: { ...member, isAdmin: true } });
  const sent: (string | undefined)[] = [];
  await page.route(`${API}/api/lab/models`, route => { if (route.request().method() === 'GET') sent.push(route.request().headers()['authorization']); return fulfill(route, { models: ['lite'] }); });
  await page.goto('/#/home');
  await page.getByRole('button', { name: /AI 실험실/ }).first().click();
  await expect(page).toHaveURL(/#\/lab$/);
  await expect.poll(() => sent.length).toBeGreaterThan(0);
  expect(new Set(sent)).toEqual(new Set(['Bearer tok-admin']));  // every lab request carries it
});
