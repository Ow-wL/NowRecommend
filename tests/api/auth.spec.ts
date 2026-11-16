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
  const calls = { signup: [] as any[], login: [] as any[], puts: [] as any[], refused: 0, gets: 0, auth: [] as string[], order: [] as string[], server,
    // passwords and sessions (2026-11-17): what was sent, and what the fake server should answer
    password: [] as any[], logoutAll: [] as (string | undefined)[], resetRequests: [] as any[], resetConfirms: [] as any[], passwordStatus: 200, resetStatus: 200, mailStatus: 202 };
  await browser.route(`${API}/api/auth/signup`, route => { if (route.request().method() === 'OPTIONS') return fulfill(route, {}); calls.signup.push(route.request().postDataJSON());
    server.store = null; server.version = 0;  // a new account has nothing saved
    return fulfill(route, { token: 'tok-1', user: server.signupUser, hasStore: false }, 201); });
  await browser.route(`${API}/api/auth/login`, route => { if (route.request().method() === 'OPTIONS') return fulfill(route, {}); calls.login.push(route.request().postDataJSON());
    return opts.loginStatus ? fulfill(route, { detail: '이메일 또는 비밀번호가 맞지 않아요.' }, opts.loginStatus) : fulfill(route, { token: 'tok-2', user, hasStore: server.store !== null }); });
  const post = (path: string, answer: (body: any, authorization?: string) => [unknown, number]) => browser.route(`${API}${path}`, route => {
    if (route.request().method() === 'OPTIONS') return fulfill(route, {});
    const [body, status] = answer(route.request().postDataJSON(), route.request().headers()['authorization']);
    return status === 204 ? route.fulfill({ status: 204, headers: cors }) : fulfill(route, body, status);
  });
  await post('/api/auth/password', (body, authorization) => { calls.password.push({ ...body, authorization }); return calls.passwordStatus === 200 ? [{ token: 'tok-new', user, hasStore: true }, 200] : [{ detail: '현재 비밀번호가 맞지 않아요.' }, calls.passwordStatus]; });
  await post('/api/auth/logout-all', (_, authorization) => { calls.logoutAll.push(authorization); return [null, 204]; });
  await post('/api/auth/reset/request', body => { calls.resetRequests.push(body); return calls.mailStatus === 202 ? [{ sent: true }, 202] : [{ detail: '이 서버에는 메일 발송이 설정되지 않았어요.' }, calls.mailStatus]; });
  await post('/api/auth/reset/confirm', body => { calls.resetConfirms.push(body); return calls.resetStatus === 200 ? [{ token: 'tok-reset', user, hasStore: server.store !== null }, 200] : [{ detail: '링크가 만료됐거나 이미 사용됐어요.' }, calls.resetStatus]; });
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
/** Ticks what sign-up asks agreement to. The boxes themselves are clicked: the labels hold links that open the documents. */
async function agree(page: Page) { for (const name of [/이용약관/, /개인정보 수집·이용/, /만 18세 이상/]) await page.getByRole('checkbox', { name }).check(); }
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
  await agree(page);
  await page.getByRole('button', { name: '가입하고 시작하기' }).click();
  await expect(page.getByRole('heading', { name: '오늘 뭐 먹고, 뭐 들을까요?' })).toBeVisible();
  await expect(page.getByText('주형님, 가입을 환영해요.', { exact: false })).toBeVisible();
  expect(calls.signup[0]).toEqual({ email: 'Lee@example.com', password: 'password1', name: '주형', termsVersion: '2026-11-17', agreeTerms: true, agreePrivacy: true, adult: true });
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
  await agree(page);
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
  expect(await page.evaluate(() => localStorage.getItem('nowrecommend-auth-v1'))).toBeNull();
  expect(await stored(page)).toMatchObject({ favorites: [], history: [] });
  expect((await stored(page))._sync).toBeUndefined();  // nobody's data: no agreement with any account is kept
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

// ---- 2026-11-17: a forgotten password, a changed one, and signing out everywhere ----

test('a forgotten password: the form asks for the mail and says the same whoever asks', async ({ page }) => {
  const calls = await setup(page, { hasStore: true });
  await page.goto('/#/login');
  await page.getByRole('button', { name: '비밀번호를 잊으셨나요?' }).click();
  await expect(page.getByLabel('비밀번호', { exact: false })).toHaveCount(0);  // only the address is asked for
  await page.getByLabel('이메일').fill(' Lee@example.com ');
  await page.getByRole('button', { name: '재설정 메일 받기' }).click();
  await expect(page.getByText('메일을 확인해주세요.')).toBeVisible();
  await expect(page.getByText('가입된 계정이 있다면', { exact: false })).toBeVisible();  // no word on whether it exists
  expect(calls.resetRequests).toEqual([{ email: 'Lee@example.com' }]);
  await page.getByRole('button', { name: '로그인으로 돌아가기' }).click();
  await expect(page.getByRole('button', { name: '비밀번호를 잊으셨나요?' })).toBeVisible();
  // A server that cannot send mail says so instead of pretending.
  calls.mailStatus = 503;
  await page.getByRole('button', { name: '비밀번호를 잊으셨나요?' }).click();
  await page.getByLabel('이메일').fill('lee@example.com');
  await page.getByRole('button', { name: '재설정 메일 받기' }).click();
  await expect(page.getByRole('alert')).toContainText('지금은 메일로 비밀번호를 다시 정할 수 없어요');
});

test('the mailed link sets a new password and signs in; the token leaves the address bar', async ({ page }) => {
  const calls = await setup(page, { hasStore: true });
  const token = 'eyJzdWIiOiJ1MSIsInVzZSI6InJlc2V0In0.c2lnbmF0dXJlLXNpZ25hdHVyZQ';
  await page.goto('/#/home');
  await expect(page.getByRole('heading', { name: '오늘 뭐 먹고, 뭐 들을까요?' })).toBeVisible();
  await page.goto(`/#/reset/${token}`);  // the link, opened in a tab where the app is already running
  await expect(page.getByRole('heading', { name: '새 비밀번호 정하기' })).toBeVisible();
  await expect(page).toHaveURL(/#\/login$/);
  // Replaced in place, not navigated away from: one step back is the home screen, not the link.
  await page.goBack();
  await expect(page).toHaveURL(/#\/home$/);
  expect(await page.evaluate(() => window.location.href)).not.toContain(token);
  await page.goto(`/#/reset/${token}`);  // leaving the login page dropped the link; the mail's link still works
  await expect(page.getByRole('heading', { name: '새 비밀번호 정하기' })).toBeVisible();
  await expect(page.getByLabel('이메일')).toHaveCount(0);
  await page.getByLabel('새 비밀번호', { exact: false }).fill('brand-new-pass');
  await page.getByRole('button', { name: '비밀번호 바꾸고 로그인' }).click();
  await expect(page.getByText('계정의 취향·기록을 불러왔어요', { exact: false })).toBeVisible();
  expect(calls.resetConfirms).toEqual([{ token, password: 'brand-new-pass' }]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('nowrecommend-auth-v1')!).token)).toBe('tok-reset');
  await expect(page.getByRole('button', { name: '내 계정' })).toBeVisible();
  await page.goto('/#/login');  // the link is spent: the login page is the ordinary one again
  await expect(page.getByRole('heading', { name: '새 비밀번호 정하기' })).toHaveCount(0);
});

test('a spent or expired link says so and offers a new mail', async ({ page }) => {
  const calls = await setup(page, { hasStore: true });
  calls.resetStatus = 400;
  await page.goto('/#/reset/eyJzdWIiOiJ1MSIsInVzZSI6InJlc2V0In0.b2xkLXNpZ25hdHVyZQ');
  await page.getByLabel('새 비밀번호', { exact: false }).fill('brand-new-pass');
  await page.getByRole('button', { name: '비밀번호 바꾸고 로그인' }).click();
  await expect(page.getByRole('alert')).toContainText('링크가 만료됐거나 이미 사용됐어요');
  expect(await page.evaluate(() => localStorage.getItem('nowrecommend-auth-v1'))).toBeNull();
  await page.getByRole('button', { name: '메일 다시 받기' }).click();
  await expect(page.getByRole('button', { name: '재설정 메일 받기' })).toBeVisible();
});

test('changing the password keeps this browser signed in with the new token; a wrong current password stays in the dialog', async ({ page }) => {
  const calls = await setup(page, { hasStore: true });
  await logIn(page);
  await expect(page.getByText('계정의 취향·기록을 불러왔어요', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '내 계정' }).click();
  await page.getByRole('button', { name: '비밀번호 변경' }).click();
  const dialog = page.getByRole('dialog');
  calls.passwordStatus = 403;
  await dialog.getByLabel('현재 비밀번호').fill('wrong-pass');
  await dialog.getByLabel('새 비밀번호', { exact: false }).fill('password2');
  await dialog.getByRole('button', { name: '비밀번호 변경' }).click();
  await expect(dialog.getByRole('alert')).toContainText('현재 비밀번호가 맞지 않아요.');
  calls.passwordStatus = 200;
  await dialog.getByLabel('현재 비밀번호').fill('password1');
  await dialog.getByRole('button', { name: '비밀번호 변경' }).click();
  await expect(page.getByText('비밀번호를 바꿨어요. 다른 기기에서는 로그아웃됐어요.')).toBeVisible();
  expect(calls.password.at(-1)).toEqual({ currentPassword: 'password1', newPassword: 'password2', authorization: 'Bearer tok-2' });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('nowrecommend-auth-v1')!).token)).toBe('tok-new');
  // The next save goes out with the new token.
  await page.getByRole('button', { name: '내 계정' }).click();
  await page.getByLabel('이름', { exact: true }).fill('지은');
  await page.getByRole('button', { name: '이름 변경' }).click();
  await expect.poll(() => calls.auth.at(-1)).toBe('Bearer tok-new');
});

test('signing out everywhere tells the server, then signs this browser out and keeps its data', async ({ page }) => {
  const calls = await setup(page, { hasStore: true });
  await logIn(page);
  await expect(page.getByText('계정의 취향·기록을 불러왔어요', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '내 계정' }).click();
  await page.getByRole('button', { name: /모든 기기에서 로그아웃/ }).click();
  await expect(page.getByText('모든 기기에서 로그아웃했어요', { exact: false })).toBeVisible();
  expect(calls.logoutAll).toEqual(['Bearer tok-2']);
  expect(await page.evaluate(() => localStorage.getItem('nowrecommend-auth-v1'))).toBeNull();
  expect(await stored(page)).toMatchObject({ favorites: ['m01', 'f09'] });
  await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeVisible();
});

test('an ended session is told as such: nothing is claimed about the other devices', async ({ page }) => {
  const calls = await setup(page, { hasStore: true });
  await logIn(page);
  await expect(page.getByText('계정의 취향·기록을 불러왔어요', { exact: false })).toBeVisible();
  await page.route(`${API}/api/auth/logout-all`, route => route.request().method() === 'OPTIONS' ? fulfill(route, {}) : fulfill(route, { detail: '로그인이 필요해요.' }, 401));
  await page.getByRole('button', { name: '내 계정' }).click();
  await page.getByRole('button', { name: /모든 기기에서 로그아웃/ }).click();
  await expect(page.getByText('다른 기기를 로그아웃하지 못했어요', { exact: false })).toBeVisible();
  await expect(page.getByText('모든 기기에서 로그아웃했어요', { exact: false })).toHaveCount(0);
  expect(calls.logoutAll).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('nowrecommend-auth-v1'))).toBeNull();  // this browser's session was over anyway
});

// ---- 2026-11-17: what a person agrees to, and where to read it ----

test('sign-up waits for the three agreements; nothing is ticked beforehand and the documents open beside the form', async ({ page }) => {
  const calls = await setup(page);
  await page.goto('/#/login');
  await page.getByRole('button', { name: '회원가입', exact: true }).click();
  await page.getByLabel('이름').fill('주형');
  await page.getByLabel('이메일').fill('lee@example.com');
  await page.getByLabel('비밀번호', { exact: false }).fill('password1');
  const submit = page.getByRole('button', { name: '가입하고 시작하기' });
  const boxes = page.getByRole('checkbox');
  await expect(boxes).toHaveCount(3);
  for (let n = 0; n < 3; n++) await expect(boxes.nth(n)).not.toBeChecked();
  await expect(submit).toBeDisabled();
  await page.getByText('이용약관에 동의해요').click();  // the words tick the box; the document has a link of its own
  await expect(page.getByRole('checkbox', { name: /이용약관/ })).toBeChecked();
  await page.getByRole('checkbox', { name: /개인정보 수집·이용/ }).check();
  await expect(submit).toBeDisabled();  // the age is asked too
  await expect(page.getByText('수집 항목: 이메일, 이름, 비밀번호', { exact: false })).toBeVisible();
  // The documents open in another tab, so what was typed stays.
  const [terms] = await Promise.all([page.context().waitForEvent('page'), page.getByRole('link', { name: '이용약관 보기 (새 탭)' }).click()]);
  await expect(terms.getByRole('heading', { name: '이용약관', level: 1 })).toBeVisible();
  await terms.close();
  await expect(page.getByLabel('이메일')).toHaveValue('lee@example.com');
  await page.getByRole('checkbox', { name: /만 18세 이상/ }).check();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText('가입을 환영해요', { exact: false })).toBeVisible();
  expect(calls.signup[0]).toMatchObject({ termsVersion: '2026-11-17', agreeTerms: true, agreePrivacy: true, adult: true });
});

test('the terms and the privacy policy are one tap from the home screen and readable without an account', async ({ page }) => {
  await setup(page);
  await page.goto('/#/home');
  await page.getByRole('button', { name: '개인정보 처리방침' }).click();
  await expect(page).toHaveURL(/#\/privacy$/);
  await expect(page.getByRole('heading', { name: '개인정보 처리방침', level: 1 })).toBeVisible();
  for (const line of ['Google LLC', 'Apple Inc.', '계정을 삭제할 때까지', '만 18세']) await expect(page.getByText(line, { exact: false }).first()).toBeVisible();
  await expect(page.getByText('운영자 정보가 아직 등록되지 않았어요.')).toBeVisible();  // this build names no operator: said, not hidden
  await page.getByRole('button', { name: '이용약관 보기' }).click();
  await expect(page).toHaveURL(/#\/terms$/);
  await expect(page.getByText('알레르기 안전을 보장하지 않습니다', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '돌아가기' }).click();
  await expect(page).toHaveURL(/#\/home$/);
});

test('the age is asked once per browser before the AI can be used; the documents stay readable without answering', async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });  // a browser that has not answered
  const page = await context.newPage();
  await setup(page);
  await page.goto('/#/home');
  const gate = page.getByRole('dialog', { name: '만 18세 이상이신가요?' });
  await expect(gate).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(gate).toBeVisible();  // no way round it but an answer
  const [terms] = await Promise.all([context.waitForEvent('page'), gate.getByRole('link', { name: '이용약관' }).click()]);
  await expect(terms.getByRole('heading', { name: '이용약관', level: 1 })).toBeVisible();
  await expect(terms.getByRole('dialog')).toHaveCount(0);  // reading the terms needs no answer
  await terms.close();
  await gate.getByRole('button', { name: '만 18세 이상이에요' }).click();
  await expect(gate).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '오늘 뭐 먹고, 뭐 들을까요?' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '오늘 뭐 먹고, 뭐 들을까요?' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);  // remembered
  await context.close();
});

test('clearing this browser removes the set-aside copies and caches too, and keeps the sign-in and the age answer', async ({ page }) => {
  await setup(page, { hasStore: true });
  await logIn(page);
  await expect(page.getByText('계정의 취향·기록을 불러왔어요', { exact: false })).toBeVisible();
  await page.evaluate(() => { localStorage.setItem('nowrecommend-song-check-v4', '{"x":1}'); localStorage.setItem('nowrecommend-known-items-v1', '{"x":1}'); });
  expect(await page.evaluate(() => localStorage.getItem('nowrecommend-prototype-v1-before-login'))).not.toBeNull();  // set aside at login
  await page.getByRole('button', { name: '내 계정' }).click();
  await page.getByRole('button', { name: '데이터 관리' }).click();
  await page.getByRole('button', { name: /이 브라우저의 데이터 모두 초기화/ }).click();
  await page.getByRole('button', { name: '삭제하기' }).click();
  await expect(page.getByText('삭제했어요.')).toBeVisible();
  const left = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('nowrecommend-')).sort());
  expect(left).toEqual(['nowrecommend-adult-v1', 'nowrecommend-auth-v1', 'nowrecommend-prototype-v1']);  // the store is written again, empty
  expect(await stored(page)).toMatchObject({ favorites: [], history: [] });
});
