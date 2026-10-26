import { test, expect, type Page, type Route } from '@playwright/test';
import { items } from '../../src/data';

// Music AI lab (plans-music-ai.md): A = catalog + AI rerank (/api/recommend), B = free AI picks (/api/lab/music/free).
const API = 'http://127.0.0.1:5999';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
const fulfill = (route: Route, body: unknown, status = 200) =>
  route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: cors }) : route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
const music = items.filter(i => i.category === 'music');
const pool = (ids: string[], mode = 'rag') => ({
  results: ids.map(id => ({ item: music.find(i => i.id === id)!, tasteReason: '풀 취향 이유', contextReason: '풀 상황 이유' })),
  meta: { mode, eligibleCount: 15, newCount: ids.length, catalogVersion: 'db-test', requestId: 'r', ai: mode === 'rag' ? 'used' : 'failed' },
});
const song = (title: string, confidence = 'high') => ({ title, artist: '자유 가수', tasteReason: '자유 취향 이유', contextReason: '자유 상황 이유', confidence });
const free = (titles: string[], model = 'lite') => ({ results: titles.map(t => song(t)), meta: { mode: 'free', requestId: 'f', model, ai: titles.length ? 'used' : 'failed', issues: titles.length ? null : 'TimeoutError', latencyMs: 900 } });

async function setup(page: Page, opts: { freeFails?: boolean } = {}) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('nowrecommend-prototype-v1')) localStorage.setItem('nowrecommend-prototype-v1', JSON.stringify({ version: 2, name: '검증',
      profiles: { food: { selected: [], tags: [], disliked: [] }, music: { selected: ['m01', 'm05', 'm13', 'm14', 'm15'], tags: [], disliked: [] } }, favorites: [], history: [] }));
  });
  await page.route(`${API}/api/catalog**`, route => fulfill(route, { catalogVersion: 'db-test', items }));
  await page.route(`${API}/api/lab/music/models`, route => fulfill(route, { models: ['lite', 'flash'] }));
  await page.route(`${API}/api/parse`, route => fulfill(route, { conditions: { tags: ['차분함'], excluded: [], maxPrice: null }, unparsed: [], source: 'rule', ai: 'not_needed' }));
  const bodies = { pool: [] as any[], free: [] as any[] };
  let poolCalls = 0, freeCalls = 0;
  await page.route(`${API}/api/recommend`, route => {
    if (route.request().method() !== 'POST') return fulfill(route, {});
    bodies.pool.push(route.request().postDataJSON());
    return fulfill(route, poolCalls++ === 0 ? pool(['m01', 'm05', 'm06', 'm07', 'm08']) : pool(['m09', 'm10', 'm11', 'm12', 'm13'], 'retrieval_only'));
  });
  await page.route(`${API}/api/lab/music/free`, route => {
    if (route.request().method() !== 'POST') return fulfill(route, {});
    const body = route.request().postDataJSON();
    bodies.free.push(body);
    if (opts.freeFails) return fulfill(route, free([]));
    return fulfill(route, freeCalls++ === 0 ? free(['첫 곡', '둘째 곡'], body.model) : free(['셋째 곡'], body.model));
  });
  return bodies;
}

test('compares the stored pool and free AI picks side by side and records a verdict', async ({ page }) => {
  const bodies = await setup(page);
  await page.goto('/#/home');
  await page.getByRole('button', { name: /음악 AI 실험/ }).click();
  await expect(page).toHaveURL(/#\/lab$/);
  await page.getByLabel('지금의 상황').fill('비 오는 밤 잔잔하게');
  await page.getByLabel('목록에 없는 좋아하는 곡·아티스트').fill('검정치마, 잔나비');
  await page.getByLabel('B 모델').selectOption('flash');
  await page.getByRole('button', { name: '추천받기', exact: true }).click();

  const columnA = page.getByRole('region', { name: '저장된 곡 목록에서' }), columnB = page.getByRole('region', { name: 'AI 자유 추천' });
  await expect(columnA.locator('h3')).toHaveText(['밤편지', '봄날', 'River Flows in You', 'Kiss the Rain', 'One Summer’s Day']);
  await expect(columnB.locator('h3')).toHaveText(['첫 곡', '둘째 곡']);
  await expect(columnB.getByText('확신 높음').first()).toBeVisible();
  await expect(columnB.getByText('flash')).toBeVisible();
  expect(bodies.pool[0]).toMatchObject({ category: 'music', raw: '비 오는 밤 잔잔하게', conditions: { tags: ['차분함'] }, seenIds: [] });
  expect(bodies.free[0]).toMatchObject({ raw: '비 오는 밤 잔잔하게', conditions: { tags: ['차분함'], excluded: [] }, likedText: ['검정치마', '잔나비'], avoid: [], model: 'flash',
    profile: { selected: ['m01', 'm05', 'm13', 'm14', 'm15'] } });

  await columnB.getByRole('button', { name: '없는 곡이에요' }).first().click();
  await page.getByRole('button', { name: 'B가 나아요' }).click();
  await expect(page.getByRole('button', { name: 'B가 나아요' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: '다른 추천 보기' }).click();
  await expect(columnB.locator('h3')).toHaveText(['셋째 곡']);
  await expect(columnA.getByText('AI가 답하지 않아 유사도 순서로 보여드려요.')).toBeVisible();
  expect(bodies.pool[1].seenIds).toEqual(['m01', 'm05', 'm06', 'm07', 'm08']);
  expect(bodies.free[1].avoid).toEqual(expect.arrayContaining(['첫 곡 - 자유 가수', '둘째 곡 - 자유 가수']));
  await expect(page.getByText('2회차')).toBeVisible();

  await page.getByText('실험 기록').click();
  await expect(page.getByText('A가 나아요 0 · 비슷해요 0 · B가 나아요 1')).toBeVisible();
  await expect(page.getByText('곡 3개 중 좋아요 0 · 별로예요 0 · 없는 곡 1')).toBeVisible();

  // The lab keeps its round across a reload and never touches the main history.
  await page.reload();
  await expect(columnB.locator('h3')).toHaveText(['셋째 곡']);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('nowrecommend-prototype-v1')!).history)).toEqual([]);
});

test('shows a free-recommendation failure without hiding the pool answer', async ({ page }) => {
  await setup(page, { freeFails: true });
  await page.goto('/#/lab');
  await page.getByRole('button', { name: '추천받기', exact: true }).click();
  await expect(page.getByRole('region', { name: '저장된 곡 목록에서' }).locator('h3')).toHaveCount(5);
  await expect(page.getByRole('region', { name: 'AI 자유 추천' }).getByRole('alert')).toContainText('AI가 곡을 추천하지 못했어요.');
  await expect(page.getByRole('region', { name: 'AI 자유 추천' })).toContainText('TimeoutError');
});
