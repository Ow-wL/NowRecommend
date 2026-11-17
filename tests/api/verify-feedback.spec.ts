import { test, expect, type Page, type Route } from '@playwright/test';
import { items } from '../../src/data';

// Sign-up confirms the address by mail (2026-11-25), and 의견 보내기. The server is faked: it answers sign-up with
// "a mail was sent", the confirmation link with "confirmed", a login before that with 403, and keeps what feedback came.
const API = 'http://127.0.0.1:5999';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE' };
const fulfill = (route: Route, body: unknown, status = 200) =>
  route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: cors }) : route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
const user = { id: 'u1', email: 'lee@example.com', name: '주형', createdAt: null };
const TOKEN = 'eyJzdWIiOiJ1MSJ9.signature-of-the-link';

async function setup(page: Page) {
  const calls = { signup: [] as any[], verify: [] as any[], login: 0, feedback: [] as any[], confirmed: false };
  const browser = page.context();
  await browser.route(`${API}/api/catalog**`, route => fulfill(route, { catalogVersion: 'db-test', items }));
  await browser.route(`${API}/api/auth/signup`, route => { if (route.request().method() !== 'OPTIONS') calls.signup.push(route.request().postDataJSON()); return fulfill(route, { verify: 'sent', email: 'lee@example.com' }, 202); });
  await browser.route(`${API}/api/auth/verify`, route => {
    if (route.request().method() === 'OPTIONS') return fulfill(route, {});
    calls.verify.push(route.request().postDataJSON()); calls.confirmed = true;
    return fulfill(route, { verified: true, email: 'lee@example.com' });
  });
  await browser.route(`${API}/api/auth/login`, route => {
    if (route.request().method() === 'OPTIONS') return fulfill(route, {});
    calls.login++;
    return calls.confirmed ? fulfill(route, { token: 'tok', user, hasStore: false }) : fulfill(route, { detail: '이메일 확인이 아직이에요. 확인 메일을 보냈어요. 메일의 버튼을 누른 뒤 다시 로그인해주세요.' }, 403);
  });
  await browser.route(`${API}/api/auth/me`, route => fulfill(route, { user, hasStore: false, storeUpdatedAt: null, storeVersion: 0 }));
  await browser.route(`${API}/api/me/store`, route => route.request().method() === 'PUT' ? fulfill(route, { updatedAt: '2026-11-25T00:00:00Z', bytes: 10, version: 1 }) : fulfill(route, { store: null, updatedAt: null, version: 0 }));
  await browser.route(`${API}/api/feedback`, route => { if (route.request().method() !== 'OPTIONS') calls.feedback.push(route.request().postDataJSON()); return fulfill(route, { id: 'fb1' }, 201); });
  return calls;
}

test('a sign-up waits for the mailed link, the link confirms with one press, and then the login works', async ({ page }) => {
  const calls = await setup(page);
  await page.goto('/#/login');
  await page.getByRole('button', { name: '회원가입' }).click();
  await page.getByLabel('이름').fill('주형');
  await page.getByLabel('이메일').fill('lee@example.com');
  await page.getByLabel('비밀번호').fill('password1');
  for (const box of await page.getByRole('checkbox').all()) await box.check();
  await page.getByRole('button', { name: '가입하고 시작하기' }).click();
  await expect(page.getByText('메일함을 확인해주세요.')).toBeVisible();
  await expect(page.getByText('lee@example.com 주소로 확인 메일을 보냈어요')).toBeVisible();
  expect(calls.signup).toHaveLength(1);
  await expect(page.getByText('로그인되어 있어요')).toHaveCount(0);  // no session yet

  await page.getByRole('button', { name: '로그인 화면으로' }).click();
  await page.getByLabel('비밀번호').fill('password1');
  await page.getByRole('button', { name: '로그인', exact: true }).last().click();
  await expect(page.getByRole('alert')).toContainText('이메일 확인이 아직이에요');

  await page.goto(`/#/verify/${TOKEN}`);
  await expect(page).toHaveURL(/#\/login$/);  // the token leaves the address bar at once
  await expect(page.getByRole('heading', { name: '이메일 확인' })).toBeVisible();
  expect(calls.verify).toHaveLength(0);  // opening the link does nothing by itself (a mail scanner would)
  await page.getByRole('button', { name: '이메일 확인하기' }).click();
  await expect(page.getByText('이메일이 확인됐어요.')).toBeVisible();
  expect(calls.verify).toEqual([{ token: TOKEN }]);
  await expect(page.getByLabel('이메일')).toHaveValue('lee@example.com');
  await page.evaluate(token => { window.location.hash = `#/verify/${token}`; }, `${TOKEN}-second`);  // another link, same page
  await expect(page.getByRole('button', { name: '이메일 확인하기' })).toBeVisible();
  await page.getByRole('button', { name: '이메일 확인하기' }).click();
  await expect(page.getByText('이메일이 확인됐어요.')).toBeVisible();
  expect(calls.verify).toEqual([{ token: TOKEN }, { token: `${TOKEN}-second` }]);
  await page.getByLabel('비밀번호').fill('password1');
  await page.getByRole('button', { name: '로그인', exact: true }).last().click();
  await expect(page.getByRole('status').filter({ hasText: '주형님' })).toBeVisible();
});

test('feedback goes without the account, names only the screen, and words about health are asked to be said otherwise', async ({ page }) => {
  const calls = await setup(page);
  await page.goto('/#/taste');
  await page.getByRole('button', { name: /의견 보내기/ }).click();
  const dialog = page.getByRole('dialog', { name: '의견 보내기' });
  await dialog.getByLabel('이런 게 있으면 좋겠어요').check();
  await dialog.getByLabel(/내용/).fill('알레르기 때문에 땅콩 빼는 게 잘 안 돼요');
  await dialog.getByRole('button', { name: '보내기' }).click();
  await expect(dialog.getByRole('alert')).toContainText('건강과 관련된 표현');
  expect(calls.feedback).toHaveLength(0);
  await dialog.getByLabel(/내용/).fill('제외 조건이 가끔 적용되지 않아요');
  await dialog.getByLabel(/답장 받을 이메일/).fill('lee@example.com');
  await dialog.getByRole('button', { name: '보내기' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('의견을 보냈어요. 고마워요!')).toBeVisible();
  expect(calls.feedback).toEqual([{ kind: 'idea', message: '제외 조건이 가끔 적용되지 않아요', contact: 'lee@example.com', page: 'taste', appVersion: expect.any(String) }]);
});
