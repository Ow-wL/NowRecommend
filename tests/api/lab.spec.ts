import { test, expect, type Page, type Route } from '@playwright/test';
import { items } from '../../src/data';

// AI lab (plans-music-ai.md, food added 2026-11-02): A = catalog + AI rerank (/api/recommend engine "catalog"),
// B = free AI picks (/api/lab/{category}/free).
const API = 'http://127.0.0.1:5999';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
const fulfill = (route: Route, body: unknown, status = 200) =>
  route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: cors }) : route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
const pool = (ids: string[], mode = 'rag') => ({
  results: ids.map(id => ({ item: items.find(i => i.id === id)!, tasteReason: '풀 취향 이유', contextReason: '풀 상황 이유' })),
  meta: { mode, engine: 'catalog', eligibleCount: 15, newCount: ids.length, catalogVersion: 'db-test', requestId: 'r', ai: mode === 'rag' ? 'used' : 'failed' },
});
const pick = (category: 'food' | 'music', name: string, confidence = 'high') => ({ name, detail: category === 'music' ? '자유 가수' : '한식 · 국물', tasteReason: '자유 취향 이유', contextReason: '자유 상황 이유', confidence, tags: category === 'music' ? ['차분함'] : ['국물'],
  item: { id: `ai-${name.replace(/\s/g, '')}`, category, name, subtitle: category === 'music' ? '자유 가수' : '국물', description: 'AI 추천', tags: category === 'music' ? ['차분함'] : ['국물'], ingredients: [], emoji: '🎵', color: '#e6dfef' } });
const free = (category: 'food' | 'music', names: string[], model = 'lite') => ({ results: names.map(n => pick(category, n)), meta: { mode: 'free', category, requestId: 'f', model, ai: names.length ? 'used' : 'failed', issues: names.length ? null : 'TimeoutError', latencyMs: 900 } });

async function setup(page: Page, opts: { freeFails?: boolean } = {}) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('nowrecommend-prototype-v1')) localStorage.setItem('nowrecommend-prototype-v1', JSON.stringify({ version: 2, name: '검증',
      profiles: { food: { selected: ['f01', 'f02'], tags: [], disliked: [] }, music: { selected: ['m01', 'm05', 'm13', 'm14', 'm15'], tags: [], disliked: [] } }, favorites: [], history: [] }));
  });
  await page.route(`${API}/api/catalog**`, route => fulfill(route, { catalogVersion: 'db-test', items }));
  await page.route(`${API}/api/lab/models`, route => fulfill(route, { models: ['lite', 'flash'] }));
  await page.route(`${API}/api/parse`, route => fulfill(route, { conditions: { tags: ['차분함'], excluded: [], maxPrice: null }, unparsed: [], source: 'rule', ai: 'not_needed' }));
  const bodies = { pool: [] as any[], free: [] as any[] };
  let poolCalls = 0, freeCalls = 0;
  await page.route(`${API}/api/recommend`, route => {
    if (route.request().method() !== 'POST') return fulfill(route, {});
    const body = route.request().postDataJSON();
    bodies.pool.push(body);
    if (body.category === 'food') return fulfill(route, pool(['f01', 'f03', 'f05']));
    return fulfill(route, poolCalls++ === 0 ? pool(['m01', 'm05', 'm06', 'm07', 'm08']) : pool(['m09', 'm10', 'm11', 'm12', 'm13'], 'retrieval_only'));
  });
  await page.route(`${API}/api/lab/*/free`, route => {
    if (route.request().method() !== 'POST') return fulfill(route, {});
    const category = route.request().url().includes('/food/') ? 'food' : 'music';
    const body = route.request().postDataJSON();
    bodies.free.push({ ...body, category });
    if (opts.freeFails) return fulfill(route, free(category, []));
    if (category === 'food') return fulfill(route, free(category, ['들기름 막국수', '콩국수', '초계국수'], body.model));
    return fulfill(route, freeCalls++ === 0 ? free(category, ['첫 곡', '둘째 곡'], body.model) : free(category, ['셋째 곡'], body.model));
  });
  return bodies;
}

test('compares the stored pool and free AI picks side by side and records a verdict (music)', async ({ page }) => {
  const bodies = await setup(page);
  await page.goto('/#/home');
  // Server mode shows the lab on the home screen; it is also reachable from 내 취향.
  await page.getByRole('button', { name: /AI 실험실/ }).first().click();
  await expect(page).toHaveURL(/#\/lab$/);
  await page.getByRole('button', { name: '음악 실험', exact: true }).click();
  await page.getByLabel('지금의 상황').fill('비 오는 밤 잔잔하게');
  await page.getByLabel('목록에 없는 좋아하는 곡·아티스트').fill('검정치마, 잔나비');
  await page.getByText('고급 설정').click();
  await page.getByLabel('B 모델').selectOption('flash');
  await page.getByRole('button', { name: /추천받기$/ }).click();

  const columnA = page.getByRole('region', { name: '등록된 후보에서 추천' }), columnB = page.getByRole('region', { name: '새로운 후보 발견' });
  await expect(columnA.locator('h3')).toHaveText(['밤편지', '봄날', 'River Flows in You', 'Kiss the Rain', 'One Summer’s Day']);
  await expect(columnB.locator('h3')).toHaveText(['첫 곡', '둘째 곡']);
  await expect(columnB.getByText('확신 높음').first()).toBeVisible();
  await expect(columnB.getByText('flash')).toBeVisible();
  expect(bodies.pool[0]).toMatchObject({ category: 'music', engine: 'catalog', raw: '비 오는 밤 잔잔하게', conditions: { tags: ['차분함'] }, seenIds: [] });
  expect(bodies.free[0]).toMatchObject({ category: 'music', raw: '비 오는 밤 잔잔하게', conditions: { tags: ['차분함'], excluded: [] }, likedText: ['검정치마', '잔나비'], avoid: [], model: 'flash', count: 5,
    profile: { selected: ['m01', 'm05', 'm13', 'm14', 'm15'] } });

  await columnB.getByRole('button', { name: '없는 곡이에요' }).first().click();
  await page.getByRole('button', { name: 'B가 나아요' }).click();
  await expect(page.getByRole('button', { name: 'B가 나아요' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: '같은 조건으로 다시 추천' }).click();
  await expect(columnB.locator('h3')).toHaveText(['셋째 곡']);
  await expect(columnA.getByText('AI가 답하지 않아 유사도 순서로 보여드려요.')).toBeVisible();
  expect(bodies.pool[1].seenIds).toEqual(['m01', 'm05', 'm06', 'm07', 'm08']);
  expect(bodies.free[1].avoid).toEqual(expect.arrayContaining(['첫 곡 - 자유 가수', '둘째 곡 - 자유 가수']));
  await expect(page.getByText('2회차')).toBeVisible();

  await page.getByText('음악 실험 기록').click();
  await expect(page.getByText('A가 나아요 0 · 비슷해요 0 · B가 나아요 1')).toBeVisible();
  await expect(page.getByText('곡 3개 중 좋아요 0 · 별로예요 0 · 없는 곡이에요 1')).toBeVisible();

  // The lab keeps its round across a reload and never touches the main history.
  await page.reload();
  await expect(columnB.locator('h3')).toHaveText(['셋째 곡']);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('nowrecommend-prototype-v1')!).history)).toEqual([]);
});

test('runs the same comparison for food with three dishes a side and its own wording', async ({ page }) => {
  const bodies = await setup(page);
  await page.goto('/#/lab');
  await expect(page.getByRole('button', { name: '음식 실험', exact: true })).toHaveAttribute('aria-pressed', 'true');  // food is the default
  await page.getByLabel('지금의 상황').fill('더운 날 가볍게');
  await page.getByLabel('목록에 없는 좋아하는 메뉴·식당 종류').fill('평양냉면');
  await page.getByRole('button', { name: /추천받기$/ }).click();
  const columnA = page.getByRole('region', { name: '등록된 후보에서 추천' }), columnB = page.getByRole('region', { name: '새로운 후보 발견' });
  await expect(columnA.locator('h3')).toHaveText(['쌀국수', items.find(i => i.id === 'f03')!.name, items.find(i => i.id === 'f05')!.name]);
  await expect(columnB.locator('h3')).toHaveText(['들기름 막국수', '콩국수', '초계국수']);
  await expect(columnB.getByText('재료·알레르기 제외는 AI의 판단이라 꼭 확인해주세요.')).toBeVisible();
  await expect(columnB.getByRole('link', { name: /네이버 지도에서 찾기/ }).first()).toHaveAttribute('href', /map\.naver\.com/);
  expect(bodies.pool[0]).toMatchObject({ category: 'food', engine: 'catalog', profile: { selected: ['f01', 'f02'] } });
  expect(bodies.free[0]).toMatchObject({ category: 'food', likedText: ['평양냉면'], count: 3 });
  await columnB.getByRole('button', { name: '조건에 안 맞아요' }).first().click();
  await page.getByRole('button', { name: '같은 조건으로 다시 추천' }).click();
  expect(bodies.free[1].avoid).toEqual(['들기름 막국수 - 한식 · 국물', '콩국수 - 한식 · 국물', '초계국수 - 한식 · 국물']);  // every shown dish, the flagged one included
  // Switching the category keeps each lab's own round.
  await page.getByRole('button', { name: '음악 실험', exact: true }).click();
  await expect(page.getByRole('region', { name: '새로운 후보 발견' })).toHaveCount(0);
  await page.getByRole('button', { name: '음식 실험', exact: true }).click();
  await expect(page.getByRole('region', { name: '새로운 후보 발견' }).locator('h3')).toHaveCount(3);
});

test('shows a free-recommendation failure without hiding the pool answer', async ({ page }) => {
  await setup(page, { freeFails: true });
  await page.goto('/#/lab');
  await page.getByRole('button', { name: '음악 실험', exact: true }).click();
  await page.getByRole('button', { name: /추천받기$/ }).click();
  await expect(page.getByRole('region', { name: '등록된 후보에서 추천' }).locator('h3')).toHaveCount(5);
  await expect(page.getByRole('region', { name: '새로운 후보 발견' }).getByRole('alert')).toContainText('AI가 곡을 추천하지 못했어요.');
  await expect(page.getByRole('region', { name: '새로운 후보 발견' })).toContainText('TimeoutError');
});

test('votes only on rounds that ran both sides, whatever the toggle shows now', async ({ page }) => {
  await setup(page);
  await page.goto('/#/lab');
  await page.getByRole('button', { name: '등록된 후보만' }).click();
  await page.getByRole('button', { name: /추천받기$/ }).click();
  await expect(page.getByRole('region', { name: '등록된 후보에서 추천' }).locator('h3')).toHaveCount(3);
  await page.getByRole('button', { name: '둘 다 나란히' }).click();
  await expect(page.getByRole('region', { name: '새로운 후보 발견' })).toHaveCount(0);
  await expect(page.getByText('이번 결과는 어느 쪽이 나았나요?')).toHaveCount(0);
});
