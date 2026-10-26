import { test, expect, type Page, type Route } from '@playwright/test';
import { items, type Item } from '../../src/data';
import { cardTool } from '../ui';

// Same origin as VITE_API_BASE_URL of the "api" project's dev server (playwright.config.ts).
const API = 'http://127.0.0.1:5999';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
const serverOnly: Item = { ...items[0], id: 'f99', name: '서버 전용 메뉴', description: '서버 카탈로그에만 있는 메뉴.' };
const food = (id: string) => [...items, serverOnly].find(i => i.id === id)!;
const batch = (ids: string[], reason = '서버가 고른 이유') => ({
  results: ids.map(id => ({ item: food(id), tasteReason: reason, contextReason: '이번 상황에 맞아요' })),
  meta: { mode: 'retrieval_only', eligibleCount: 17, newCount: ids.length, catalogVersion: 'db-test', requestId: 'r' },
});
const fulfill = (route: Route, body: unknown, status = 200) =>
  route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: cors }) : route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });

async function seedProfile(page: Page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('nowrecommend-prototype-v1')) localStorage.setItem('nowrecommend-prototype-v1', JSON.stringify({ version: 2, name: '검증',
      profiles: { food: { selected: ['f01', 'f02', 'f03', 'f04', 'f05'], tags: [], disliked: [] }, music: { selected: [], tags: [], disliked: [] } }, favorites: [], history: [] }));
  });
}
async function catalogRoute(page: Page, mode: 'ok' | 'down' = 'ok') {
  await page.route(`${API}/api/catalog**`, route => mode === 'down' ? route.abort() : fulfill(route, { catalogVersion: 'db-test', items: [...items, serverOnly] }));
}
async function requestFood(page: Page) {
  await page.goto('/#/recommend/food');
  await page.getByRole('button', { name: '추천받기', exact: true }).click();
}
const cardNames = (page: Page) => page.locator('.result-grid h3').allTextContents();

test('recommends from the API server and its catalog', async ({ page }) => {
  await seedProfile(page); await catalogRoute(page);
  const bodies: any[] = [];
  await page.route(`${API}/api/recommend`, route => { if (route.request().method() === 'POST') bodies.push(route.request().postDataJSON()); return fulfill(route, batch(['f99', 'f02', 'f12'])); });
  await requestFood(page);
  await expect(page.locator('.result-grid h3').first()).toHaveText('서버 전용 메뉴');
  await expect(page.getByText('서버가 고른 이유').first()).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ category: 'food', profile: { selected: ['f01', 'f02', 'f03', 'f04', 'f05'] }, seenIds: [], candidateIds: null });
  await expect(page.getByText('기본 추천으로 보여드리고 있어요.')).toHaveCount(0);
});

test('offers a retry and the local fallback when the server fails', async ({ page }) => {
  await seedProfile(page); await catalogRoute(page, 'down');
  let healthy = false;
  await page.route(`${API}/api/recommend`, route => healthy ? fulfill(route, batch(['f12', 'f07', 'f10'])) : fulfill(route, { detail: 'down' }, 503));
  await requestFood(page);
  await expect(page.getByRole('alert')).toContainText('추천 서버에 연결하지 못했어요.');
  await expect(page.getByRole('button', { name: '다시 시도하기' })).toBeVisible();
  await page.getByRole('button', { name: '기본 추천으로 보기' }).click();
  await expect(page.getByText('기본 추천으로 보여드리고 있어요.')).toBeVisible();
  expect(await cardNames(page)).toHaveLength(3); // bundled catalog still works while the catalog API is down
  healthy = true;
  await page.getByRole('button', { name: '다른 추천 보기' }).click();
  await expect(page.locator('.result-grid h3').first()).toHaveText(food('f12').name);
  await expect(page.getByText('기본 추천으로 보여드리고 있어요.')).toHaveCount(0);
});

test('shows progress and sends one request for repeated clicks', async ({ page }) => {
  await seedProfile(page); await catalogRoute(page);
  let posts = 0;
  await page.route(`${API}/api/recommend`, async route => {
    if (route.request().method() === 'POST') posts++;
    await new Promise(resolve => setTimeout(resolve, 800));
    return fulfill(route, batch(['f02', 'f07', 'f12']));
  });
  await page.goto('/#/recommend/food');
  const submit = page.getByRole('button', { name: '추천받기', exact: true });
  await submit.click();
  const progress = page.getByRole('button', { name: '추천을 고르는 중' });
  await expect(progress).toBeDisabled();
  await progress.click({ force: true });
  await expect(page.locator('.result-grid h3')).toHaveCount(3);
  expect(posts).toBe(1);
});

test('replaces a single card through the server', async ({ page }) => {
  await seedProfile(page); await catalogRoute(page);
  const bodies: any[] = [];
  await page.route(`${API}/api/recommend`, route => {
    const body = route.request().postDataJSON();
    if (body) bodies.push(body);
    return fulfill(route, body?.count === 1 ? batch(['f14'], '교체 이유') : batch(['f02', 'f07', 'f12']));
  });
  await requestFood(page);
  await cardTool(page, food('f07').name, '한 장 교체');
  await expect(page.locator('.result-grid h3')).toHaveText([food('f02').name, food('f14').name, food('f12').name]);
  // The server returned one card; the comparison of the cards kept is redone for the new set (mocked API, not real AI).
  const kept = page.locator('.item-card').filter({ hasText: food('f12').name }).locator('.contrast');
  await expect(kept).toHaveText('다른 후보와 비교추천 중 유일하게 고소한 메뉴예요.'); // 비빔밥, also 고소함, has left
  await expect(page.locator('.item-card').filter({ hasText: food('f02').name }).locator('.contrast')).toHaveText('다른 후보와 비교추천 중 유일하게 국물 있는 메뉴예요.');
  await expect(page.getByText(/이전에 본 후보/)).toHaveCount(0); // a replacement is not a repeat
  expect(bodies[1]).toMatchObject({ count: 1, pinnedIds: [] });
  expect(bodies[1].excludedIds).toEqual(expect.arrayContaining(['f02', 'f07', 'f12']));
});

const SENTENCE = '속이 안 좋아서 부담 없는 걸로';
// One submit reads the sentence (server parse when the rules missed words) and then recommends.
async function submitSentence(page: Page, text = SENTENCE) {
  await page.goto('/#/recommend/food');
  await page.locator('#situation').fill(text);
  await page.getByRole('button', { name: '추천받기', exact: true }).click();
}
const recommendRoute = (page: Page, sink: any[] = []) => page.route(`${API}/api/recommend`, route => { if (route.request().method() === 'POST') sink.push(route.request().postDataJSON()); return fulfill(route, batch(['f02', 'f12', 'f09'])); });

test('reads missed words with the server and keeps the answer for the same sentence', async ({ page }) => {
  await seedProfile(page); await catalogRoute(page);
  const parses: any[] = [], recommends: any[] = [];
  await page.route(`${API}/api/parse`, route => {
    if (route.request().method() === 'POST') parses.push(route.request().postDataJSON());
    return fulfill(route, { conditions: { tags: ['담백함', '따뜻함'], excluded: ['매콤함'], maxPrice: null }, unparsed: ['좋아서'], source: 'rule+ai', ai: 'used' });
  });
  await recommendRoute(page, recommends);
  await submitSentence(page);
  await expect(page.locator('.result-grid h3')).toHaveCount(3);
  await expect(page.getByText('AI가 문장을 함께 해석했어요.')).toBeVisible();
  await expect(page.getByText('적용하지 않은 표현: 좋아서')).toBeVisible();
  expect(parses).toEqual([{ category: 'food', text: SENTENCE }]);
  expect(recommends[0].conditions.tags).toEqual(expect.arrayContaining(['담백함', '따뜻함']));
  expect(recommends[0].conditions.excluded).toEqual(['매콤함']);
  await page.getByRole('button', { name: '조건 수정', exact: true }).click();
  await expect(page.getByRole('button', { name: '매콤함 제외 조건 삭제' })).toBeVisible();
  await page.getByRole('button', { name: '따뜻함 조건 삭제' }).click();
  await page.getByRole('button', { name: '추천받기', exact: true }).click();
  await expect(page.locator('.result-grid h3')).toHaveCount(3);
  expect(parses).toHaveLength(1); // the same sentence is not sent again
  expect(recommends[1].conditions).toEqual({ tags: ['담백함'], excluded: ['매콤함'] }); // no budget is ever sent
  await page.getByRole('button', { name: '조건 수정', exact: true }).click();
  await expect(page.getByRole('button', { name: '따뜻함 조건 삭제' })).toHaveCount(0); // the removal survives re-submitting
});

test('falls back to the browser rules when parsing fails', async ({ page }) => {
  await seedProfile(page); await catalogRoute(page); await recommendRoute(page);
  await page.route(`${API}/api/parse`, route => fulfill(route, { detail: 'down' }, 503));
  await submitSentence(page);
  await expect(page.getByText('서버에 연결하지 못해 기본 규칙으로 해석했어요.')).toBeVisible();
  await expect(page.locator('.result-summary')).toContainText('담백함');
});

test('does not ask the server about an empty sentence', async ({ page }) => {
  await seedProfile(page); await catalogRoute(page); await recommendRoute(page);
  let parses = 0;
  await page.route(`${API}/api/parse`, route => { parses++; return fulfill(route, {}); });
  await page.goto('/#/recommend/food');
  await page.getByRole('button', { name: '추천받기', exact: true }).click();
  await expect(page.locator('.result-grid h3')).toHaveCount(3);
  expect(parses).toBe(0);
});
test('says when the server answered without the AI or the sentence meaning', async ({ page }) => {
  await seedProfile(page); await catalogRoute(page);
  let degraded = true;
  await page.route(`${API}/api/recommend`, route => {
    const body = batch(degraded ? ['f02', 'f12', 'f09'] : ['f01', 'f07', 'f10']);
    return fulfill(route, { ...body, meta: { ...body.meta, ...(degraded ? { ai: 'failed', situational: true, contextSimilarity: false } : { mode: 'rag', ai: 'used', situational: true, contextSimilarity: true }) } });
  });
  await requestFood(page);
  await expect(page.getByText('기본 방식으로 추천했어요.')).toBeVisible();
  await expect(page.getByText('문장의 의미를 분석하지 못해', { exact: false })).toBeVisible();
  await expect(page.getByText('AI 설명을 받지 못해', { exact: false })).toBeVisible();
  await page.reload();  // the notice belongs to the restored cards
  await expect(page.getByText('기본 방식으로 추천했어요.')).toBeVisible();
  degraded = false;
  await page.getByRole('button', { name: '다른 추천 보기' }).click();
  await expect(page.locator('.result-grid h3').first()).toHaveText(food('f01').name);
  await expect(page.getByText('기본 방식으로 추천했어요.')).toHaveCount(0);
});

// 2026-10-27: the AI wrote "과제할 때 어울려요" for a song without the 과제 tag while the card read "– 과제" (해당 없음).
// A missing tag now reads "미등록" and never "해당 없음"; the reason stays the server's, and no tag is added.
test('a wanted condition missing from the item tags reads as not registered, not as unmet', async ({ page }) => {
  await seedProfile(page); await catalogRoute(page);
  const tagged = items.filter(i => i.category === 'food' && i.tags.includes('혼자'))[0], untagged = items.filter(i => i.category === 'food' && !i.tags.includes('혼자'))[0];
  await page.route(`${API}/api/recommend`, route => fulfill(route, { ...batch([tagged.id, untagged.id]), results: [tagged, untagged].map(item => ({ item, tasteReason: '좋아하는 맛에 가까워요', contextReason: '혼자 먹기 좋아요' })) }));
  await submitSentence(page, '혼자 먹을 메뉴');
  const card = page.locator('.item-card').filter({ has: page.getByRole('heading', { name: untagged.name, exact: true }) });
  const check = card.locator('.condition-checks li.untagged');
  await expect(check).toHaveText(/혼자 미등록/);
  await expect(check.locator('.sr-only')).toHaveText('혼자 특징 미등록');
  await expect(check).toHaveAttribute('title', /맞지 않는다는 뜻은 아니에요/);
  await expect(card.locator('.reasons')).toContainText('혼자 먹기 좋아요');
  await expect(page.locator('.item-card').filter({ has: page.getByRole('heading', { name: tagged.name, exact: true }) }).locator('.condition-checks li.met .sr-only')).toHaveText('혼자 특징 있음');
  await expect(page.locator('.check-legend')).toContainText('미등록은 데이터에 그 특징이 없다는 뜻이고, 맞지 않는다는 뜻은 아니에요.');
  await expect(page.getByText('해당 없음')).toHaveCount(0);
  expect(untagged.tags).not.toContain('혼자');
});
