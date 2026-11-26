import { test, expect, type Route } from '@playwright/test';
import { items } from '../../src/data';

// The admin console's 회원 (2026-11-26), against a fake server: the status column stays a table cell (its pills sat in a
// flex box that had left the table, so the row's line and background broke there), the owner gives admin rights with its
// password typed again, and 서비스로 돌아가기 lands on the home screen.
const API = 'http://127.0.0.1:5999';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE' };
const fulfill = (route: Route, body: unknown, status = 200) =>
  route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: cors }) : route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
const owner = { id: 'o1', email: 'owner@example.com', name: '운영자', createdAt: null, isAdmin: true };
const row = (id: string, more = {}) => ({ id, email: `${id}*****@example.com`, name: '이**', createdAt: '2026-11-17T00:00:00Z', lastLoginAt: '2026-11-23T00:00:00Z', verified: true, isAdmin: false, suspended: false, hasData: true, ...more });
const details = (more = {}) => ({ ...row('m1'), email: 'member@example.com', name: '이주형', verifiedAt: '2026-11-17T00:00:00Z', suspendedAt: null, suspendedReason: null,
  termsVersion: null, termsAgreedAt: null, store: { bytes: 0, version: 0, updatedAt: null, counts: {} }, aiToday: { used: 0, limit: 100 },
  reports: { open: 0, resolved: 0, dismissed: 0 }, actions: [], owner: false, canSetAdmin: true, ...more });

async function signedIn(page: import('@playwright/test').Page) {
  await page.context().addInitScript(account => { localStorage.setItem('nowrecommend-auth-v1', JSON.stringify(account)); }, { token: 'tok', user: owner });
  await page.route(`${API}/api/catalog**`, route => fulfill(route, { catalogVersion: 'db-test', items }));
  await page.route(`${API}/api/auth/me`, route => fulfill(route, { user: owner, hasStore: false, storeUpdatedAt: null, storeVersion: 0 }));
  await page.route(`${API}/api/me/store`, route => fulfill(route, { store: null, updatedAt: null, version: 0 }));
  await page.route(`${API}/api/stats`, route => route.request().method() === 'OPTIONS' ? fulfill(route, {}) : route.fulfill({ status: 204, headers: cors }));
  await page.route(`${API}/api/admin/members/search`, route => fulfill(route, { members: [row('m1'), row('m2', { verified: false }), row('m3', { isAdmin: true })], total: 3, page: 1, size: 25 }));
}

test('the status column lines up with the rest of its row', async ({ page }) => {
  await signedIn(page);
  await page.goto('/#/admin/members');
  const rows = page.locator('.ac-table tbody tr');
  await expect(rows).toHaveCount(3);
  for (let n = 0; n < 3; n++) {
    const cells = rows.nth(n).locator('td');
    expect(await cells.nth(2).evaluate(td => getComputedStyle(td).display)).toBe('table-cell');
    const [status, joined] = [await cells.nth(2).boundingBox(), await cells.nth(3).boundingBox()];
    expect(Math.abs(status!.y - joined!.y)).toBeLessThan(1);
    expect(Math.abs(status!.height - joined!.height)).toBeLessThan(1);
  }
  await page.locator('.ac-table').screenshot({ path: 'test-results/admin-members-status.png' });
});

test('the owner makes a member an admin with its password, and the way back is the home screen', async ({ page }) => {
  await signedIn(page);
  const sent: any[] = [];
  await page.route(`${API}/api/admin/members/m1`, route => fulfill(route, details()));
  await page.route(`${API}/api/admin/members/m1/admin`, route => { if (route.request().method() === 'POST') sent.push(route.request().postDataJSON());
    return fulfill(route, details({ isAdmin: true, actions: [{ id: 1, at: '2026-11-26T01:00:00Z', actor: 'owner@example.com', action: 'grant_admin', targetType: 'member', targetId: 'm1', reason: '운영 도움', detail: {} }] })); });
  await page.goto('/#/admin/members');
  await page.locator('.ac-table tbody tr').first().getByRole('button').click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: '관리자로 지정' }).click();
  const confirm = sheet.locator('form.ac-confirm');
  await expect(confirm.getByRole('button', { name: '관리자로 지정' })).toBeDisabled();
  await confirm.getByLabel(/^이유/).fill('운영 도움');
  await expect(confirm.getByRole('button', { name: '관리자로 지정' })).toBeDisabled();  // the password too
  await confirm.getByLabel('내 비밀번호 (확인용)').fill('password1');
  await confirm.getByRole('button', { name: '관리자로 지정' }).click();
  await expect(sheet).toContainText('관리자로 지정했어요');
  await expect(sheet.getByRole('button', { name: '관리자 권한 거두기' })).toBeVisible();
  await expect(sheet.locator('.ac-timeline')).toContainText('관리자 지정');
  expect(sent).toEqual([{ grant: true, reason: '운영 도움', password: 'password1', endSessions: false }]);
  await sheet.getByRole('button', { name: /닫기/ }).first().click();
  await page.getByRole('button', { name: '서비스로 돌아가기' }).click();
  await expect(page).toHaveURL(/#\/home$/);
});

test('a wrong password says so, not "sign in as an admin"', async ({ page }) => {
  await signedIn(page);
  await page.route(`${API}/api/admin/members/m1`, route => fulfill(route, details()));
  await page.route(`${API}/api/admin/members/m1/admin`, route => fulfill(route, { detail: '비밀번호가 맞지 않아요.' }, 401));
  await page.goto('/#/admin/members');
  await page.locator('.ac-table tbody tr').first().getByRole('button').click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: '관리자로 지정' }).click();
  await sheet.getByLabel(/^이유/).fill('운영 도움');
  await sheet.getByLabel('내 비밀번호 (확인용)').fill('wrong');
  await sheet.locator('form.ac-confirm').getByRole('button', { name: '관리자로 지정' }).click();
  await expect(sheet.locator('.ac-news')).toHaveText('비밀번호가 맞지 않아요.');
  await expect(sheet.getByLabel('내 비밀번호 (확인용)')).toHaveValue('');
});

test('another admin sees no admin-rights buttons', async ({ page }) => {
  await signedIn(page);
  await page.route(`${API}/api/admin/members/m1`, route => fulfill(route, details({ canSetAdmin: false })));
  await page.goto('/#/admin/members');
  await page.locator('.ac-table tbody tr').first().getByRole('button').click();
  await expect(page.getByRole('dialog').getByRole('button', { name: '이용 정지' })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: /관리자로 지정|권한 거두기/ })).toHaveCount(0);
});
