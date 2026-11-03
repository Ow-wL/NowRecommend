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
  await page.getByRole('button', { name: /추천받기$/ }).click();
}
// AI picks are looked up in the Apple store; nothing here should reach the real one.
test.beforeEach(async ({ page }) => { await page.route('https://itunes.apple.com/**', route => route.abort()); });
const cardNames = (page: Page) => page.locator('.result-grid h3').allTextContents();

test('recommends from the API server and its catalog', async ({ page }) => {
  await seedProfile(page); await catalogRoute(page);
  const bodies: any[] = [];
  await page.route(`${API}/api/recommend`, route => { if (route.request().method() === 'POST') bodies.push(route.request().postDataJSON()); return fulfill(route, batch(['f99', 'f02', 'f12'])); });
  await requestFood(page);
  await expect(page.locator('.result-grid h3').first()).toHaveText('서버 전용 메뉴');
  await page.locator('.result-grid .why summary').first().click();  // the taste reason opens on demand
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
  await page.getByRole('button', { name: '같은 조건으로 다시 추천' }).click();
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
  const submit = page.getByRole('button', { name: /추천받기$/ });
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
  await expect(kept).toHaveText('고소한 메뉴예요.'); // 비빔밥, also 고소함, has left
  await expect(page.locator('.item-card').filter({ hasText: food('f02').name }).locator('.contrast')).toHaveText('국물 있는 메뉴예요.');
  await expect(page.getByText(/이전에 본 후보/)).toHaveCount(0); // a replacement is not a repeat
  expect(bodies[1]).toMatchObject({ count: 1, pinnedIds: [] });
  expect(bodies[1].excludedIds).toEqual(expect.arrayContaining(['f02', 'f07', 'f12']));
});

const SENTENCE = '속이 안 좋아서 부담 없는 걸로';
// One submit reads the sentence (server parse when the rules missed words) and then recommends.
async function submitSentence(page: Page, text = SENTENCE) {
  await page.goto('/#/recommend/food');
  await page.locator('#situation').fill(text);
  await page.getByRole('button', { name: /추천받기$/ }).click();
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
  await page.getByRole('button', { name: '조건 바꾸기', exact: true }).click();
  await expect(page.getByRole('button', { name: '매콤함 제외 조건 삭제' })).toBeVisible();
  await page.getByRole('button', { name: '따뜻함 조건 삭제' }).click();
  await page.getByRole('button', { name: /추천받기$/ }).click();
  await expect(page.locator('.result-grid h3')).toHaveCount(3);
  expect(parses).toHaveLength(1); // the same sentence is not sent again
  expect(recommends[1].conditions).toEqual({ tags: ['담백함'], excluded: ['매콤함'] }); // no budget is ever sent
  await page.getByRole('button', { name: '조건 바꾸기', exact: true }).click();
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
  await page.getByRole('button', { name: /추천받기$/ }).click();
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
  await page.getByRole('button', { name: '같은 조건으로 다시 추천' }).click();
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
  await expect(check.locator('.sr-only')).toHaveText('혼자: 등록 정보 없음');
  await expect(card.locator('.reasons')).toContainText('혼자 먹기 좋아요');
  await expect(page.locator('.item-card').filter({ has: page.getByRole('heading', { name: tagged.name, exact: true }) }).locator('.condition-checks li.met .sr-only')).toHaveText('혼자 맞음');
  await expect(page.locator('.check-legend')).toContainText('미등록은 데이터에 그 특징이 없다는 뜻이고, 맞지 않는다는 뜻은 아니에요.');
  await expect(page.getByText('해당 없음')).toHaveCount(0);
  expect(untagged.tags).not.toContain('혼자');
});

test('an AI song the Apple store lists gets its cover and page; one it does not is marked', async ({ page }) => {
  await seedProfile(page); await catalogRoute(page);
  const pick = (name: string) => ({ item: { id: `ai-${name.replace(/\s/g, '')}`, category: 'music', name, subtitle: '테스트 가수', description: '', tags: [], ingredients: [], emoji: '', color: '' }, tasteReason: '좋아하는 분위기에 가까워요', contextReason: '지금 듣기 좋아요', aiPick: true, confidence: 'high' });
  await page.route(`${API}/api/recommend`, route => fulfill(route, { results: [pick('있는 곡'), pick('없는 곡')], meta: { mode: 'rag', engine: 'ai', ai: 'used', eligibleCount: 2, newCount: 2, catalogVersion: 'db-test', requestId: 'r' } }));
  await page.route('https://itunes.apple.com/**', route => {
    const known = decodeURIComponent(route.request().url().replace(/\+/g, ' ')).includes('있는 곡') && !route.request().url().includes(encodeURIComponent('없는').replace(/%20/g, '+')) || route.request().url().includes('/lookup');
    return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ results: known ? [{ trackName: '있는 곡', artistName: '테스트 가수', trackViewUrl: 'https://music.apple.com/kr/album/x/1?i=2', artworkUrl100: 'https://example.test/100x100bb.jpg' }] : [] }) });
  });
  await page.goto('/#/recommend/music');
  await page.getByRole('button', { name: /추천받기$/ }).click();
  const found = page.locator('.item-card').filter({ has: page.getByRole('heading', { name: '있는 곡', exact: true }) });
  const missing = page.locator('.item-card').filter({ has: page.getByRole('heading', { name: '없는 곡', exact: true }) });
  await expect(found.getByRole('link', { name: /Apple Music에서 듣기/ })).toHaveAttribute('href', 'https://music.apple.com/kr/song/x/2');
  await expect(found).not.toContainText('일치하는 정보를 찾지 못했어요');
  await expect(missing).toContainText('일치하는 정보를 찾지 못했어요');
  await expect(missing.getByRole('link', { name: /YouTube에서 찾기/ })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '곡 중' })).toHaveText('2곡 중 1곡은 곡 정보를 확인하지 못했어요');
  await expect(missing.locator('.lead')).toContainText('AI가 제안한 이유');
  await expect(found.locator('.lead')).not.toContainText('AI가 제안한 이유');
  await missing.getByRole('button', { name: '없는 곡 더보기' }).click();
  await missing.getByRole('button', { name: '없는 곡 추천 이유 보기' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'AI가 제안한 이유' })).toBeVisible();
});

test('AI food names detail menus, borrows the general dish photo, and can ask within a broad name', async ({ page }) => {
  await seedProfile(page); await catalogRoute(page);
  const dish = (id: string, name: string, subtitle: string, extra: object = {}) => ({ item: { id, category: 'food', name, subtitle, description: '', tags: ['고소함'], ingredients: ['닭고기'], emoji: '', color: '', ...extra }, tasteReason: '고소한 맛에 가까워요', contextReason: '함께 먹기 좋아요', aiPick: true, confidence: 'high' });
  const sentences: string[] = [];
  await page.route(`${API}/api/recommend`, route => {
    if (route.request().method() === 'POST') sentences.push(route.request().postDataJSON().raw);
    const refined = sentences.at(-1)?.includes('중에서');
    return fulfill(route, { results: refined ? [dish('ai-bburinkle', '뿌링클', 'BHC · 치킨', { parentId: 'f13' }), dish('ai-honey', '허니콤보', '교촌치킨 · 치킨', { parentId: 'f13' }), dish('ai-olive', '황금올리브', 'BBQ · 치킨', { parentId: 'f13' })]
      : [{ ...dish('ai-chicken', '치킨', '치킨'), broad: true }, dish('ai-noodle', '들기름 막국수', '한식 · 차가운 면')], meta: { mode: 'rag', engine: 'ai', ai: 'used', eligibleCount: 3, newCount: 3, catalogVersion: 'db-test', requestId: 'r' } });
  });
  await page.goto('/#/recommend/food');
  await page.getByRole('button', { name: /추천받기$/ }).click();
  await expect(page.locator('.item-card').filter({ hasText: '들기름 막국수' })).toContainText('한식 · 차가운 면');
  await expect(page.locator('.item-card').filter({ hasText: '들기름 막국수' }).locator('.refine-button')).toHaveCount(0);  // already one menu
  await page.getByRole('button', { name: '치킨 세부 메뉴 보기' }).click();
  await expect(page.locator('.result-grid h3')).toHaveText(['뿌링클', '허니콤보', '황금올리브']);
  await expect(page.locator('h1')).toHaveText('치킨 중에서 골라줘');
  await expect(page.locator('h1')).toBeFocused();
  expect(sentences.at(-1)).toBe('치킨 중에서 골라줘');
  const first = page.locator('.item-card').first();
  await expect(first).toContainText('BHC · 치킨');
  await expect(first).toContainText('이미지는 참고용이에요');  // the 치킨 photo stands in for 뿌링클
  await expect(first.locator('img')).toHaveCount(1);
});

test('AI food with an exclusion says the check rests on estimated ingredients', async ({ page }) => {
  await seedProfile(page); await catalogRoute(page);
  const item = { id: 'ai-safe', category: 'food', name: '메뉴', subtitle: '한식', description: '', tags: [], ingredients: [], emoji: '', color: '' };
  await page.route(`${API}/api/recommend`, route => fulfill(route, { results: [{ item, tasteReason: 't', contextReason: 'c', aiPick: true, confidence: 'high' }], meta: { mode: 'rag', engine: 'ai', ai: 'used', eligibleCount: 1, newCount: 1, catalogVersion: 'db-test', requestId: 'r' } }));
  await page.route(`${API}/api/parse`, route => fulfill(route, { conditions: { tags: [], excluded: ['밀'] }, source: 'rule', unparsed: [] }));
  await page.goto('/#/recommend/food');
  await page.getByLabel('지금의 상황').fill('밀가루 빼고 저녁');
  await page.getByRole('button', { name: /추천받기$/ }).click();
  await expect(page.getByText('제외 조건은 AI가 추정한 재료로 확인했어요.')).toBeVisible();
});

test('a song not confirmed in the Korean store leads with a search and keeps the overseas page in the menu', async ({ page }) => {
  await seedProfile(page); await catalogRoute(page);
  const item = { id: 'ai-해외곡', category: 'music', name: '해외곡', subtitle: '테스트 가수', description: '', tags: [], ingredients: [], emoji: '', color: '' };
  await page.route(`${API}/api/recommend`, route => fulfill(route, { results: [{ item, tasteReason: '좋아하는 분위기에 가까워요', contextReason: '지금 듣기 좋아요', aiPick: true, confidence: 'high' }], meta: { mode: 'rag', engine: 'ai', ai: 'used', eligibleCount: 1, newCount: 1, catalogVersion: 'db-test', requestId: 'r' } }));
  await page.route('https://itunes.apple.com/**', route => route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ results: route.request().url().includes('/lookup') ? [] : [{ trackName: '해외곡', artistName: '테스트 가수', trackViewUrl: 'https://music.apple.com/us/album/x/1?i=2', artworkUrl100: 'https://example.test/100x100bb.jpg' }] }) }));
  await page.goto('/#/recommend/music');
  await page.getByRole('button', { name: /추천받기$/ }).click();
  const card = page.locator('.item-card').first();
  await expect(card.getByRole('link', { name: /YouTube에서 찾기/ })).toBeVisible();
  await expect(card.locator('.listen-button')).toHaveText('YouTube에서 찾기');
  await expect(page.locator('.song-summary')).toHaveCount(0);  // the song itself was found
  await card.locator('.more-toggle').click();
  const overseas = card.locator('.overseas-link');
  await expect(overseas).toHaveAttribute('href', 'https://music.apple.com/us/song/x/2');
  await expect(overseas).toContainText('Apple Music 해외 스토어에서 보기');
  await expect(overseas).toContainText('한국 계정 이용 가능 여부 미확인');
  const box = await page.locator('.more-menu').boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0);
  await card.getByRole('button', { name: '해외곡 추천 이유 보기' }).click();
  await expect(page.getByRole('dialog')).toContainText('한국 계정에서 들을 수 있는지는 확인하지 못했어요');
  await expect(page.getByRole('dialog').getByRole('heading', { name: '추천 이유' })).toBeVisible();
});

test('a song whose asked guest the store does not show says so and keeps its song page', async ({ page }) => {
  await seedProfile(page); await catalogRoute(page);
  const item = { id: 'ai-참여곡', category: 'music', name: '참여곡 (feat. 손님)', subtitle: '테스트 가수', description: '', tags: [], ingredients: [], emoji: '', color: '' };
  await page.route(`${API}/api/recommend`, route => fulfill(route, { results: [{ item, tasteReason: '좋아하는 분위기에 가까워요', contextReason: '지금 듣기 좋아요', aiPick: true, confidence: 'high' }], meta: { mode: 'rag', engine: 'ai', ai: 'used', eligibleCount: 1, newCount: 1, catalogVersion: 'db-test', requestId: 'r' } }));
  await page.route('https://itunes.apple.com/**', route => route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ results: [{ trackName: '참여곡', artistName: '테스트 가수', trackViewUrl: 'https://music.apple.com/kr/album/x/1?i=2', artworkUrl100: 'https://example.test/100x100bb.jpg' }] }) }));
  await page.goto('/#/recommend/music');
  await page.getByRole('button', { name: /추천받기$/ }).click();
  const card = page.locator('.item-card').first();
  await expect(card).toContainText('요청한 참여자는 확인하지 못했어요');
  await expect(card.getByRole('link', { name: /Apple Music에서 듣기/ })).toHaveAttribute('href', 'https://music.apple.com/kr/song/x/2');
});

test('a failed store request says so and can be tried again, unlike a song that is not listed', async ({ page }) => {
  await seedProfile(page); await catalogRoute(page);
  const item = { id: 'ai-다시확인', category: 'music', name: '다시 확인', subtitle: '테스트 가수', description: '', tags: [], ingredients: [], emoji: '', color: '' };
  await page.route(`${API}/api/recommend`, route => fulfill(route, { results: [{ item, tasteReason: '좋아하는 분위기에 가까워요', contextReason: '지금 듣기 좋아요', aiPick: true, confidence: 'high' }], meta: { mode: 'rag', engine: 'ai', ai: 'used', eligibleCount: 1, newCount: 1, catalogVersion: 'db-test', requestId: 'r' } }));
  await page.goto('/#/recommend/music');
  await page.getByRole('button', { name: /추천받기$/ }).click();
  const card = page.locator('.item-card').first();
  await expect(card).toContainText('지금은 확인할 수 없어요');  // beforeEach aborts every store request
  await expect(card).not.toContainText('일치하는 정보를 찾지 못했어요');
  await page.route('https://itunes.apple.com/**', route => route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ results: [{ trackName: '다시 확인', artistName: '테스트 가수', trackViewUrl: 'https://music.apple.com/kr/album/x/1?i=2', artworkUrl100: 'https://example.test/100x100bb.jpg' }] }) }));
  await card.getByRole('button', { name: '다시 확인', exact: true }).click();
  await expect(card.locator('h3')).toBeFocused();  // the button is gone, the keyboard place is not
  await expect(card.getByRole('link', { name: /Apple Music에서 듣기/ })).toHaveAttribute('href', 'https://music.apple.com/kr/song/x/2');
  await expect(card.getByRole('status')).toContainText('Apple Music에서 곡을 찾았어요');
  await expect(card).not.toContainText('지금은 확인할 수 없어요');
});
