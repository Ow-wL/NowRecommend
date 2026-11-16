import { test, expect, type Page, type Route } from '@playwright/test';
import { items } from '../../src/data';

// Accounts (2026-11-02): sign-up uploads this browser's store, login downloads the account's copy, changes sync back.
// Since 2026-11-16 the account's copy has a version: a save names the version it was built on, and a refused save is
// merged with the newer copy instead of overwriting it (src/sync.ts). The fake server below keeps that version.
const API = 'http://127.0.0.1:5999';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE' };
const fulfill = (route: Route, body: unknown, status = 200) =>
  route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: cors }) : route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
const user = { id: 'u1', email: 'lee@example.com', name: '주형', createdAt: null };
const localStore = { version: 2, name: '취향 탐험가', profiles: { food: { selected: ['f01', 'f02', 'f03'], tags: [], disliked: [] }, music: { selected: [], tags: [], disliked: [] } }, favorites: ['f05'], history: [] };
const remoteStore = { version: 2, name: '주형', profiles: { food: { selected: ['f07'], tags: ['매콤함'], disliked: [] }, music: { selected: ['m01'], tags: [], disliked: [] } }, favorites: ['m01', 'f09'], history: [] };

async function setup(page: Page, opts: { hasStore?: boolean; loginStatus?: number; signedIn?: boolean } = {}) {
  const browser = page.context();  // routes and the seed apply to every tab of this browser
  await browser.addInitScript(([value, account]) => {
    if (!localStorage.getItem('nowrecommend-prototype-v1')) localStorage.setItem('nowrecommend-prototype-v1', JSON.stringify(value));
    if (account && !sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('nowrecommend-auth-v1', JSON.stringify(account)); }
  }, [localStore, opts.signedIn ? { token: 'tok-2', user } : null] as const);
  await browser.route(`${API}/api/catalog**`, route => fulfill(route, { catalogVersion: 'db-test', items }));
  // The account on the server: its store and the version that moves on every accepted save.
  const server = { store: (opts.hasStore === false ? null : remoteStore) as any, version: opts.hasStore === false ? 0 : 3, getFails: false, signupUser: user };
  const calls = { signup: [] as any[], login: [] as any[], puts: [] as any[], refused: 0, gets: 0, auth: [] as string[], order: [] as string[], server };
  await browser.route(`${API}/api/auth/signup`, route => { if (route.request().method() === 'OPTIONS') return fulfill(route, {}); calls.signup.push(route.request().postDataJSON());
    server.store = null; server.version = 0;  // a new account has nothing saved
    return fulfill(route, { token: 'tok-1', user: server.signupUser, hasStore: false }, 201); });
  await browser.route(`${API}/api/auth/login`, route => { if (route.request().method() === 'OPTIONS') return fulfill(route, {}); calls.login.push(route.request().postDataJSON());
    return opts.loginStatus ? fulfill(route, { detail: '이메일 또는 비밀번호가 맞지 않아요.' }, opts.loginStatus) : fulfill(route, { token: 'tok-2', user, hasStore: server.store !== null }); });
  await browser.route(`${API}/api/auth/me`, route => fulfill(route, { user, hasStore: server.store !== null, storeUpdatedAt: null, storeVersion: server.version }));
  await browser.route(`${API}/api/me/store`, route => {
    const method = route.request().method();
    if (method === 'OPTIONS') return fulfill(route, {});
    calls.auth.push(route.request().headers()['authorization']);
    calls.order.push(method);
    if (method === 'PUT') {
      const body = route.request().postDataJSON();
      calls.puts.push(body);
      if (body.baseVersion !== server.version) { calls.refused++; return fulfill(route, { detail: '다른 기기에서 먼저 저장했어요.' }, 409); }
      server.store = body.store; server.version++;
      return fulfill(route, { updatedAt: '2026-11-02T00:00:00Z', bytes: 100, version: server.version });
    }
    calls.gets++;
    return server.getFails ? route.abort() : fulfill(route, { store: server.store, updatedAt: '2026-11-01T00:00:00Z', version: server.version });
  });
  return calls;
}
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('nowrecommend-prototype-v1')!));
async function logIn(page: Page) {
  await page.goto('/#/login');
  await page.getByLabel('이메일').fill('lee@example.com');
  await page.getByLabel('비밀번호', { exact: false }).fill('password1');
  await page.getByRole('button', { name: '로그인', exact: true }).last().click();
}

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
  await expect(page.getByRole('heading', { name: '오늘 뭐 먹고, 뭐 들을까요?' })).toBeVisible();
  await expect(page.getByText('주형님, 가입을 환영해요.', { exact: false })).toBeVisible();
  expect(calls.signup[0]).toEqual({ email: 'Lee@example.com', password: 'password1', name: '주형' });
  // The store was uploaded with the token; its content is still the local data, now carrying the account name.
  await expect.poll(() => calls.puts.length).toBeGreaterThan(0);
  expect(calls.auth[0]).toBe('Bearer tok-1');
  expect(calls.puts[0].store).toMatchObject({ name: '주형', favorites: ['f05'], profiles: { food: { selected: ['f01', 'f02', 'f03'] } } });
  expect(calls.puts[0].baseVersion).toBe(0);  // on top of the empty account it had just read
  expect(calls.order.slice(0, 2)).toEqual(['GET', 'PUT']);
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
  await page.getByRole('button', { name: /^로그아웃 \(/ }).click();
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

test('a failed account save is told, named on the account button and can be retried; logging out on the page keeps focus', async ({ page }) => {
  await setup(page, { hasStore: true });
  await page.goto('/#/login');
  await page.getByLabel('이메일').fill('lee@example.com');
  await page.getByLabel('비밀번호', { exact: false }).fill('password1');
  await page.getByRole('button', { name: '로그인', exact: true }).last().click();
  await expect(page.getByText('계정의 취향·기록을 불러왔어요', { exact: false })).toBeVisible();
  let down = true;
  await page.route(`${API}/api/me/store`, route => down && route.request().method() === 'PUT' ? route.abort() : route.fallback());
  await page.getByRole('button', { name: '내 계정' }).click();
  await page.getByLabel('이름', { exact: true }).fill('새 이름');
  await page.getByRole('button', { name: '이름 변경' }).click();
  await expect(page.getByText('계정에 저장하지 못했어요', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '내 계정, 저장 실패' }).click();
  await expect(page.locator('.sync-state')).toContainText('저장 실패');
  down = false;
  await page.getByRole('button', { name: '다시 저장' }).click();
  await expect(page.locator('.sync-state')).toBeFocused();
  await expect(page.locator('.sync-state')).toContainText('계정에 저장됨');
  await expect(page.getByRole('button', { name: '다시 저장' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.goto('/#/login');
  await page.getByRole('button', { name: '로그아웃' }).click();
  await expect(page.locator('#main-content')).toBeFocused();
});

test('a wrong password in the delete dialog shows inside the dialog', async ({ page }) => {
  await setup(page, { hasStore: true });
  await page.route(`${API}/api/auth/delete`, route => fulfill(route, { detail: 'no' }, 401));
  await page.goto('/#/login');
  await page.getByLabel('이메일').fill('lee@example.com');
  await page.getByLabel('비밀번호', { exact: false }).fill('password1');
  await page.getByRole('button', { name: '로그인', exact: true }).last().click();
  await expect(page.getByText('계정의 취향·기록을 불러왔어요', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '내 계정' }).click();
  await page.getByRole('button', { name: /계정과 계정 데이터 삭제/ }).click();
  await page.getByLabel('비밀번호 확인').fill('wrong-pass');
  await page.getByRole('button', { name: '계정 삭제' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('비밀번호가 맞지 않아요.');
});

// ---- 2026-11-16: the account's data must survive a second device, a failed read and a second person ----

test('an already signed-in browser reads the account before it saves, so an old copy cannot replace newer data', async ({ page }) => {
  // This browser signed in before versions existed: it holds a token, its own store and no memory of an agreement.
  const calls = await setup(page, { signedIn: true });
  await page.goto('/#/home');
  await expect.poll(() => calls.puts.length).toBeGreaterThan(0);
  expect(calls.order.slice(0, 2)).toEqual(['GET', 'PUT']);
  expect(calls.puts[0].baseVersion).toBe(3);
  // Nothing the account had is gone, and what only this browser had was added.
  expect(calls.server.store.favorites).toEqual(['m01', 'f09', 'f05']);
  expect(calls.server.store.profiles.food.selected).toEqual(['f07', 'f01', 'f02', 'f03']);
  expect(calls.server.store.profiles.music.selected).toEqual(['m01']);
  await expect.poll(async () => (await stored(page)).favorites).toEqual(['m01', 'f09', 'f05']);
  expect(calls.refused).toBe(0);
});

test('a save another device beat is merged with the newer copy, not forced over it', async ({ page }) => {
  const calls = await setup(page, { hasStore: true });
  await logIn(page);
  await expect(page.getByText('계정의 취향·기록을 불러왔어요', { exact: false })).toBeVisible();
  // Meanwhile the phone saved a new favourite.
  calls.server.store = { ...remoteStore, favorites: ['m01', 'f09', 'm05'] }; calls.server.version = 4;
  await page.getByRole('button', { name: '내 계정' }).click();
  await page.getByLabel('이름', { exact: true }).fill('지은');
  await page.getByRole('button', { name: '이름 변경' }).click();
  await expect.poll(() => calls.server.version).toBe(5);
  expect(calls.refused).toBe(1);
  expect(calls.puts.map(p => p.baseVersion)).toEqual([3, 4]);
  expect(calls.server.store).toMatchObject({ name: '지은', favorites: ['m01', 'f09', 'm05'] });
  await expect.poll(async () => (await stored(page)).favorites).toEqual(['m01', 'f09', 'm05']);
  await expect(page.getByText('계정에 저장하지 못했어요', { exact: false })).toHaveCount(0);
});

test('login stops when the account’s data cannot be read: nobody is signed in and nothing is uploaded', async ({ page }) => {
  const calls = await setup(page, { hasStore: true });
  calls.server.getFails = true;
  await logIn(page);
  await expect(page.getByRole('alert')).toContainText('서버에 연결하지 못했어요');
  await expect(page).toHaveURL(/#\/login$/);
  expect(await page.evaluate(() => localStorage.getItem('nowrecommend-auth-v1'))).toBeNull();
  // A copy from a newer build than this one is not "no data" either.
  calls.server.getFails = false; calls.server.store = { version: 99 };
  await page.getByRole('button', { name: '로그인', exact: true }).last().click();
  await expect(page.getByRole('alert')).toContainText('계정에 저장된 데이터를 읽지 못했어요');
  expect(await page.evaluate(() => localStorage.getItem('nowrecommend-auth-v1'))).toBeNull();
  expect(calls.puts).toHaveLength(0);
  expect(await stored(page)).toMatchObject({ favorites: ['f05'] });  // this browser's data is untouched
});

test('a second person signing up in the same browser does not receive the first person’s data', async ({ page }) => {
  const calls = await setup(page, { hasStore: true });
  await logIn(page);
  await expect(page.getByText('계정의 취향·기록을 불러왔어요', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '내 계정' }).click();
  await page.getByRole('button', { name: /^로그아웃 \(/ }).click();
  expect(await stored(page)).toMatchObject({ favorites: ['m01', 'f09'] });  // the first person's data stays in the browser
  const before = calls.puts.length;
  calls.server.signupUser = { id: 'u2', email: 'kim@example.com', name: '지은', createdAt: null };
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.getByRole('button', { name: '회원가입', exact: true }).click();
  await page.getByLabel('이름').fill('지은');
  await page.getByLabel('이메일').fill('kim@example.com');
  await page.getByLabel('비밀번호', { exact: false }).fill('password2');
  await page.getByRole('button', { name: '가입하고 시작하기' }).click();
  await expect(page.getByText('다른 계정의 데이터는 올리지 않았어요', { exact: false })).toBeVisible();
  await expect.poll(() => calls.puts.length).toBeGreaterThan(before);
  for (const put of calls.puts.slice(before)) expect(put.store).toMatchObject({ name: '지은', favorites: [], profiles: { food: { selected: [] }, music: { selected: [] } } });
  expect(await stored(page)).toMatchObject({ name: '지은', favorites: [] });
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('nowrecommend-prototype-v1-before-login')!))).toMatchObject({ favorites: ['m01', 'f09'] });
});

test('logging out and clearing saves what is unsaved first, then empties this browser', async ({ page }) => {
  const calls = await setup(page, { hasStore: true });
  await logIn(page);
  await expect(page.getByText('계정의 취향·기록을 불러왔어요', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '내 계정' }).click();
  await page.getByLabel('이름', { exact: true }).fill('새 이름');
  await page.getByRole('button', { name: '이름 변경' }).click();
  await page.getByRole('button', { name: '내 계정' }).click();
  await page.getByRole('button', { name: /로그아웃하고 이 브라우저에서 지우기/ }).click();  // right away, before the 1.5s save
  await expect(page.getByText('로그아웃하고 이 브라우저의 데이터를 지웠어요', { exact: false })).toBeVisible();
  expect(calls.server.store.name).toBe('새 이름');
  expect(await page.evaluate(() => [localStorage.getItem('nowrecommend-auth-v1'), localStorage.getItem('nowrecommend-sync-v1')])).toEqual([null, null]);
  expect(await stored(page)).toMatchObject({ favorites: [], history: [] });
  await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeVisible();
});

// ---- two tabs of one browser ----

test('two tabs on one account: each saves on top of what it knows, so neither drops the other’s change', async ({ page }) => {
  const calls = await setup(page, { hasStore: true });
  await logIn(page);
  await expect(page.getByText('계정의 취향·기록을 불러왔어요', { exact: false })).toBeVisible();
  const second = await page.context().newPage();
  await second.goto('/#/home');
  await expect(second.getByRole('button', { name: '내 계정' })).toBeVisible();
  await expect.poll(() => calls.gets).toBe(2);  // the second tab read the account when it opened
  // The first tab renames; the second, which has not seen that, switches to the dark theme.
  await page.getByRole('button', { name: '내 계정' }).click();
  await page.getByLabel('이름', { exact: true }).fill('지은');
  await page.getByRole('button', { name: '이름 변경' }).click();
  await expect.poll(() => calls.server.version).toBe(4);
  await second.getByRole('button', { name: '내 계정' }).click();
  await second.getByRole('button', { name: '화면', exact: true }).click();
  await second.getByRole('button', { name: '다크', exact: true }).click();
  await expect.poll(() => calls.server.version).toBe(5);
  expect(calls.refused).toBe(1);  // the second tab's save named version 3 and was refused, then merged
  expect(calls.server.store).toMatchObject({ name: '지은', appearance: { mode: 'dark' }, favorites: ['m01', 'f09'] });
  await expect.poll(async () => (await stored(second)).name).toBe('지은');
});

test('signing out in one tab restarts the other tab, which then is signed out too', async ({ page }) => {
  await setup(page, { hasStore: true });
  await logIn(page);
  await expect(page.getByText('계정의 취향·기록을 불러왔어요', { exact: false })).toBeVisible();
  const second = await page.context().newPage();
  await second.goto('/#/home');
  await expect(second.getByRole('button', { name: '내 계정' })).toBeVisible();
  await page.getByRole('button', { name: '내 계정' }).click();
  await page.getByRole('button', { name: /^로그아웃 \(/ }).click();
  await expect(second.getByRole('button', { name: '로그인', exact: true })).toBeVisible();
  await expect(second.getByRole('button', { name: '내 계정' })).toHaveCount(0);
});
