import { test, expect, type Page, type Route } from '@playwright/test';
import { items } from '../../src/data';

// Accounts (2026-11-02): sign-up uploads this browser's store, login downloads the account's copy, changes sync back.
const API = 'http://127.0.0.1:5999';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE' };
const fulfill = (route: Route, body: unknown, status = 200) =>
  route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: cors }) : route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
const user = { id: 'u1', email: 'lee@example.com', name: '주형', createdAt: null };
const localStore = { version: 2, name: '취향 탐험가', profiles: { food: { selected: ['f01', 'f02', 'f03'], tags: [], disliked: [] }, music: { selected: [], tags: [], disliked: [] } }, favorites: ['f05'], history: [] };
const remoteStore = { version: 2, name: '주형', profiles: { food: { selected: ['f07'], tags: ['매콤함'], disliked: [] }, music: { selected: ['m01'], tags: [], disliked: [] } }, favorites: ['m01', 'f09'], history: [] };

async function setup(page: Page, opts: { hasStore?: boolean; loginStatus?: number } = {}) {
  await page.addInitScript(value => { if (!localStorage.getItem('nowrecommend-prototype-v1')) localStorage.setItem('nowrecommend-prototype-v1', JSON.stringify(value)); }, localStore);
  await page.route(`${API}/api/catalog**`, route => fulfill(route, { catalogVersion: 'db-test', items }));
  const calls = { signup: [] as any[], login: [] as any[], puts: [] as any[], gets: 0, auth: [] as string[] };
  await page.route(`${API}/api/auth/signup`, route => { if (route.request().method() === 'OPTIONS') return fulfill(route, {}); calls.signup.push(route.request().postDataJSON()); return fulfill(route, { token: 'tok-1', user, hasStore: false }, 201); });
  await page.route(`${API}/api/auth/login`, route => { if (route.request().method() === 'OPTIONS') return fulfill(route, {}); calls.login.push(route.request().postDataJSON());
    return opts.loginStatus ? fulfill(route, { detail: '이메일 또는 비밀번호가 맞지 않아요.' }, opts.loginStatus) : fulfill(route, { token: 'tok-2', user, hasStore: opts.hasStore ?? true }); });
  await page.route(`${API}/api/me/store`, route => {
    const method = route.request().method();
    if (method === 'OPTIONS') return fulfill(route, {});
    calls.auth.push(route.request().headers()['authorization']);
    if (method === 'PUT') { calls.puts.push(route.request().postDataJSON()); return fulfill(route, { updatedAt: '2026-11-02T00:00:00Z', bytes: 100 }); }
    calls.gets++;
    return fulfill(route, { store: opts.hasStore === false ? null : remoteStore, updatedAt: '2026-11-01T00:00:00Z' });
  });
  return calls;
}
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('nowrecommend-prototype-v1')!));

test('signing up keeps this browser’s data, names it after the account and starts syncing', async ({ page }) => {
  const calls = await setup(page);
  await page.goto('/#/home');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page).toHaveURL(/#\/login$/);
  await page.getByRole('button', { name: '회원가입', exact: true }).click();
  await page.getByLabel('이름').fill('주형');
  await page.getByLabel('이메일').fill('Lee@example.com');
  await page.getByLabel('비밀번호', { exact: false }).fill('password1');
  await page.getByRole('button', { name: '가입하고 시작하기' }).click();
  await expect(page.getByRole('heading', { name: '지금, 어떤 선택이 필요하세요?' })).toBeVisible();
  await expect(page.getByText('주형님, 가입을 환영해요.', { exact: false })).toBeVisible();
  expect(calls.signup[0]).toEqual({ email: 'Lee@example.com', password: 'password1', name: '주형' });
  // The store was uploaded with the token; its content is still the local data, now carrying the account name.
  await expect.poll(() => calls.puts.length).toBeGreaterThan(0);
  expect(calls.auth[0]).toBe('Bearer tok-1');
  expect(calls.puts[0].store).toMatchObject({ name: '주형', favorites: ['f05'], profiles: { food: { selected: ['f01', 'f02', 'f03'] } } });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('nowrecommend-auth-v1')!))).toMatchObject({ token: 'tok-1', user: { email: 'lee@example.com' } });
  await expect(page.getByRole('button', { name: '로그인', exact: true })).toHaveCount(0);
  // A later change syncs again.
  const before = calls.puts.length;
  await page.getByRole('button', { name: '내 계정' }).click();
  await expect(page.getByText('lee@example.com')).toBeVisible();
  await page.getByLabel('이름').fill('지은');
  await page.getByRole('button', { name: '이름 변경' }).click();
  await expect.poll(() => calls.puts.length).toBeGreaterThan(before);
  expect(calls.puts.at(-1).store.name).toBe('지은');
});

test('logging in downloads the account’s store and keeps the local copy aside; logging out keeps the data', async ({ page }) => {
  const calls = await setup(page, { hasStore: true });
  await page.goto('/#/login');
  await page.getByLabel('이메일').fill('lee@example.com');
  await page.getByLabel('비밀번호', { exact: false }).fill('password1');
  await page.getByRole('button', { name: '로그인', exact: true }).last().click();
  await expect(page.getByText('계정의 취향·기록을 불러왔어요', { exact: false })).toBeVisible();
  expect(calls.gets).toBe(1);
  expect(await stored(page)).toMatchObject({ name: '주형', favorites: ['m01', 'f09'], profiles: { food: { selected: ['f07'], tags: ['매콤함'] } } });
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('nowrecommend-prototype-v1-before-login')!))).toMatchObject({ favorites: ['f05'] });
  await page.reload();
  await expect(page.getByRole('button', { name: '내 계정' })).toBeVisible();
  await page.getByRole('button', { name: '내 계정' }).click();
  await page.getByRole('button', { name: /^로그아웃/ }).click();
  await expect(page.getByText('로그아웃했어요', { exact: false })).toBeVisible();
  expect(await stored(page)).toMatchObject({ favorites: ['m01', 'f09'] });  // data stays in the browser
  expect(await page.evaluate(() => localStorage.getItem('nowrecommend-auth-v1'))).toBeNull();
  await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeVisible();
});

test('a wrong password shows the server message and stays on the form', async ({ page }) => {
  const calls = await setup(page, { loginStatus: 401 });
  await page.goto('/#/login');
  await page.getByLabel('이메일').fill('lee@example.com');
  await page.getByLabel('비밀번호', { exact: false }).fill('wrong-pass');
  await page.getByRole('button', { name: '로그인', exact: true }).last().click();
  await expect(page.getByRole('alert')).toContainText('이메일 또는 비밀번호가 맞지 않아요.');
  await expect(page).toHaveURL(/#\/login$/);
  expect(calls.login).toHaveLength(1);
  expect(calls.puts).toHaveLength(0);
  await page.getByRole('button', { name: '로그인 없이 계속' }).click();
  await expect(page).toHaveURL(/#\/home$/);
});
