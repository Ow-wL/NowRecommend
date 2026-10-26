import { test, expect, type Page } from '@playwright/test';

// Strict review of 2026-10-27 (artifacts/strict-review/REVIEW.md): offline cases, browser rules only.
async function startWithoutTaste(page: Page, sentence: string) {
  await page.goto('/'); await page.getByRole('button', { name: '음식 추천', exact: true }).click();
  await page.getByRole('button', { name: '취향 없이 바로 추천받기' }).click();
  await page.getByLabel('지금의 상황').fill(sentence);
}

test('an explicit sesame exclusion is applied, and an unknown one is reported before recommending', async ({ page }) => {
  await startWithoutTaste(page, '혼자 먹을 점심, 참깨는 빼줘');
  await expect(page.locator('.condition-summary .chip')).toHaveText(['혼자', '점심', '참깨 제외']);
  await expect(page.locator('.condition-summary')).toContainText('문장에서 알아본 표현만 조건으로 바꿔요.');
  await page.getByRole('button', { name: '추천받기', exact: true }).click();
  await expect(page.locator('.result-grid .item-card')).toHaveCount(3);
  await expect(page.locator('.result-grid')).not.toContainText('비빔밥');
  await page.screenshot({ path: 'artifacts/review-fix-sesame-results.png', fullPage: true });
  await page.getByRole('button', { name: '조건 수정', exact: true }).click();
  await page.getByLabel('지금의 상황').fill('혼자 먹을 점심, 오이랑 고수 빼줘');
  await expect(page.locator('.condition-note.unsupported')).toContainText('‘오이 제외’, ‘고수 제외’ 등록된 재료·특징에 없어 이 제외는 반영하지 못해요.');
  await expect(page.locator('.action-warning')).toHaveText('지원하지 않는 조건 2개는 반영하지 않아요');
});

test('rerolls show unseen menus first, say when they do not match, and only then report everything seen', async ({ page }) => {
  await startWithoutTaste(page, '국물');
  await page.getByRole('button', { name: '추천받기', exact: true }).click();
  const seen = new Set(await page.locator('.result-grid h3').allTextContents());
  const reroll = page.getByRole('button', { name: '다른 추천 보기', exact: true });
  for (let round = 2; round <= 6; round++) {
    await reroll.click();
    await expect(page.locator('.result-grid .item-card')).toHaveCount(3);
    const names = await page.locator('.result-grid h3').allTextContents();
    const fresh = names.filter(n => !seen.has(n));
    expect(fresh.length, `round ${round}`).toBe(round < 6 ? 3 : 1); // 16 menus: 5 full rounds, then one left
    names.forEach(n => seen.add(n));
    if (round < 6) await expect(page.getByText('새로운 후보를 모두 살펴봤어요.', { exact: true })).toHaveCount(0);
    if (round === 2) {
      await expect(page.locator('.notice').filter({ hasText: '고른 조건(국물)에 맞는 새 후보가 부족해요.' })).toContainText('이번 후보 중 1개는 고른 조건과 겹치지 않아요.');
      await page.screenshot({ path: 'artifacts/review-fix-reroll.png', fullPage: true });
    }
  }
  await expect(page.locator('.notice').filter({ hasText: '새 후보 1개 + 이전 후보 2개' })).toBeVisible();
  await reroll.click();
  await expect(page.getByText('새로운 후보를 모두 살펴봤어요.', { exact: true })).toBeVisible();
});

test('after a one-card replacement every comparison describes the three cards shown, also in history', async ({ page }) => {
  await startWithoutTaste(page, '채소');
  await page.getByRole('button', { name: '추천받기', exact: true }).click();
  await page.getByRole('button', { name: '비빔밥 더보기', exact: true }).click();
  await page.getByRole('button', { name: '비빔밥 한 장 교체', exact: true }).click();
  await expect(page.locator('.result-grid h3')).toHaveText(['채소 카레', '샌드위치', '두부 덮밥']);
  const grid = page.locator('.result-grid');
  await expect(grid).not.toContainText('유일하게 따뜻한');      // 채소 카레 and 두부 덮밥 are both warm
  await expect(grid).not.toContainText('유일하게 채소가 많은'); // all three have vegetables
  await expect(page.locator('.item-card').filter({ hasText: '두부 덮밥' }).locator('.contrast')).toHaveText('다른 후보와 비교추천 중 유일하게 고소한 메뉴예요.');
  await expect(page.locator('.item-card').filter({ hasText: '샌드위치' }).locator('.contrast')).toHaveText('다른 후보와 비교추천 중 유일하게 차가운 메뉴예요.'); // 두부 덮밥 is also 담백함
  await expect(page.getByText(/이전에 본 후보/)).toHaveCount(0); // the two cards kept are not repeats
  await page.screenshot({ path: 'artifacts/review-fix-replacement.png', fullPage: true });
  await page.locator('.item-card').filter({ hasText: '두부 덮밥' }).locator('.select-button').click();
  await expect(page.locator('.completion-panel')).toContainText('추천 중 유일하게 고소한 메뉴예요.');
  await page.getByRole('button', { name: '선택 변경', exact: true }).click();
  // The first round keeps what was true for its own three cards.
  await expect(page.getByRole('dialog').locator('.history-round').first()).toContainText('당시 비교: 추천 중 유일하게 따뜻한 메뉴예요.');
});

// Second review: a negated phrase must never become a wanted condition, and every listed item is applied or reported.
for (const [sentence, label] of [['국물 있는 건 빼줘', '국물'], ['고소한 건 빼줘', '고소함']] as const) {
  test(`"${sentence}" is reported as unsupported, not wanted`, async ({ page }) => {
    await startWithoutTaste(page, sentence);
    await expect(page.locator('.condition-summary .chip')).toHaveCount(0);
    await expect(page.locator('.condition-note.unsupported')).toContainText(`‘${label} 제외’ 이 특징을 빼는 조건은 아직 지원하지 않아요. 원하는 조건으로도 반영하지 않았어요.`);
    await expect(page.locator('.action-warning')).toHaveText('지원하지 않는 조건 1개는 반영하지 않아요');
    await page.screenshot({ path: `artifacts/review-fix-negated-${label}.png` });
    await page.getByRole('button', { name: '추천받기', exact: true }).click();
    await expect(page.locator('.result-grid .item-card')).toHaveCount(3);
    await expect(page.locator('.result-summary .mini-tags')).toHaveText('취향·조건 없음');
  });
}

test('a comma list keeps every item: 참깨 applied, 고수 reported', async ({ page }) => {
  await startWithoutTaste(page, '혼자 먹을 점심, 고수, 참깨 빼줘');
  await expect(page.locator('.condition-summary .chip')).toHaveText(['혼자', '점심', '참깨 제외']);
  await expect(page.locator('.condition-note.unsupported')).toContainText('‘고수 제외’ 등록된 재료·특징에 없어 이 제외는 반영하지 못해요.');
});

test('one-letter ingredients with a particle: 깨는 is excluded, 파는 is reported', async ({ page }) => {
  await startWithoutTaste(page, '혼자 먹을 점심, 깨는 빼줘');
  await expect(page.locator('.condition-summary .chip')).toHaveText(['혼자', '점심', '참깨 제외']);
  await page.getByRole('button', { name: '추천받기', exact: true }).click();
  await expect(page.locator('.result-grid .item-card')).toHaveCount(3);
  await expect(page.locator('.result-grid')).not.toContainText('비빔밥');
  await page.getByRole('button', { name: '조건 수정', exact: true }).click();
  await page.getByLabel('지금의 상황').fill('혼자 먹을 점심, 파는 빼줘');
  await expect(page.locator('.condition-note.unsupported')).toContainText('‘파 제외’');
});
