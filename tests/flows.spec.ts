import { test, expect } from '@playwright/test';
import { excludeCard, onboard, openConditions } from './ui';

test('condition edits preserve manual choices, and a price is named as unsupported, never applied', async ({ page }) => {
  await page.goto('/'); await onboard(page);
  await page.getByLabel('지금의 상황').fill('매운 점심, 이만원 이하');
  // Before recommending: the price is listed as unsupported; there is no budget field or chip anywhere.
  await expect(page.locator('.condition-note.unsupported')).toContainText('‘이만원 이하’ 가격 조건은 지원하지 않아요. 취향과 상황을 기준으로 메뉴를 추천해요.');
  await openConditions(page);
  await expect(page.getByLabel('참고 예산 상한')).toHaveCount(0);
  await page.getByRole('button', { name: '혼자', exact: true }).click();
  await page.getByLabel('매콤함 조건 삭제').click();
  await expect(page.locator('.condition-summary .chip')).toHaveText(['점심', '혼자']);
  // Submitting the same sentence again must not bring the removed automatic condition back.
  await page.getByRole('button', { name: '추천받기', exact: true }).click();
  await expect(page.locator('.result-summary .mini-tags')).not.toContainText('원');
  await page.getByRole('button', { name: '조건 수정', exact: true }).click();
  await expect(page.getByLabel('매콤함 조건 삭제')).toHaveCount(0);
  await page.getByLabel('지금의 상황').fill('담백한 저녁, 1만 5천원 이하');
  await expect(page.getByLabel('점심 조건 삭제')).toHaveCount(0);
  await expect(page.getByLabel('담백함 조건 삭제')).toBeVisible();
  await expect(page.getByLabel('혼자 조건 삭제')).toBeVisible();
});

test('the reproduction sentence: kept, partial and unsupported conditions before and after recommending', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '음식 추천', exact: true }).click();
  await page.getByRole('button', { name: '취향 없이 바로 추천받기' }).click();
  await page.getByLabel('지금의 상황').fill('혼자 먹을 만원 이하 저녁, 해산물은 빼고 맵지 않게, 배달 가능한 메뉴');
  await expect(page.locator('.condition-summary .chip')).toHaveText(['혼자', '저녁', '매콤함 제외', '해산물 제외']);
  await expect(page.locator('.condition-note.partial')).toContainText('해산물 제외는 등록 재료의 생선만 확인해 뺄 수 있어요.');
  await expect(page.locator('.condition-note.unsupported')).toContainText('‘만원 이하’ 가격 조건은 지원하지 않아요.');
  await expect(page.locator('.condition-note.unsupported')).toContainText('‘배달 가능한’ 배달·포장 가능 여부는 확인하지 않아요.');
  await page.getByRole('button', { name: '추천받기', exact: true }).click();
  const cards = page.locator('.result-grid .item-card');
  await expect(cards).toHaveCount(3);
  // Exclusions reach only as far as the registered data: no "always" promise, and a partial one never reads as applied.
  await expect(page.locator('.check-legend')).toContainText('재료·특징 제외는 등록된 정보를 기준으로 적용하며, 일부 확인·미지원 조건은 따로 표시해요.');
  await expect(page.locator('main')).not.toContainText('항상 지켜요');
  for (const card of await cards.all()) {
    await expect(card).not.toContainText('원');
    await expect(card.locator('.condition-checks .partial')).toContainText('해산물 일부 확인');
    await expect(card.locator('.condition-checks .partial .sr-only')).toHaveText('해산물 제외 일부만 확인');
    await expect(card.locator('.condition-checks li.exclude.met .sr-only')).toHaveText('맵지 않음, 등록 정보 기준 적용');
    await expect(card.getByRole('link', { name: /네이버 지도에서 검색/ })).toHaveAttribute('href', /^https:\/\/map\.naver\.com\/p\/search\//);
  }
  await expect(page.locator('.result-grid')).not.toContainText('평소 취향'); // no taste registered: no taste claim on the cards
  await page.locator('.result-grid .select-button').first().click();
  await expect(page.getByRole('heading', { name: '선택을 기록했어요' })).toBeVisible();
  await expect(page.getByRole('link', { name: /만개의레시피에서 레시피 검색/ })).toHaveAttribute('href', /^https:\/\/www\.10000recipe\.com\/recipe\/list\.html\?q=/);
});

test('food journey, favorites, history and browser persistence', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '지금, 어떤 선택이 필요하세요?' })).toBeVisible();
  await page.getByRole('button', { name: '음식 추천', exact: true }).click();
  await expect(page.getByRole('button', { name: '저장하고 시작' })).toBeDisabled();
  const choices = page.locator('.selection-card');
  for (let i = 0; i < 5; i++) await choices.nth(i).click();
  await page.getByRole('button', { name: '저장하고 시작' }).click();
  await page.getByLabel('지금의 상황').fill('혼자 먹을 안 매운 저녁, 밀 제외');
  await expect(page.getByLabel('매콤함 제외 조건 삭제')).toBeVisible();
  await page.getByRole('button', { name: '추천받기', exact: true }).click();
  await expect(page.locator('.result-grid .item-card')).toHaveCount(3);
  await expect(page.locator('.result-grid')).not.toContainText('김치찌개');
  await page.locator('.result-grid .save-button').first().click();
  const chosenName = await page.locator('.result-grid h3').first().textContent();
  await page.getByRole('button', { name: '즐겨찾기', exact: false }).first().click();
  await expect(page.locator('.collection-grid .item-card')).toHaveCount(1);
  await page.reload();
  await page.getByRole('button', { name: '즐겨찾기', exact: false }).first().click();
  await expect(page.locator('.collection-grid')).toContainText(chosenName!);
  await page.getByRole('button', { name: '추천 기록', exact: true }).click();
  await expect(page.locator('.history-row')).toHaveCount(1);
  await page.locator('.history-title').click();
  await expect(page.getByRole('dialog')).toContainText('밀 제외');
  await page.getByRole('button', { name: '같은 조건으로 다시 추천' }).click();
  await expect(page.getByRole('heading', { name: '지금, 어떤 한 끼가 필요하세요?' })).toBeVisible();
});

test('session exclusion clears while long feedback persists and can be reversed', async ({ page }) => {
  await page.goto('/'); await onboard(page);
  await page.getByLabel('지금의 상황').fill('담백한 저녁');
  await page.getByRole('button', { name: '추천받기', exact: true }).click();
  const first = await page.locator('.result-grid h3').first().textContent();
  await excludeCard(page);
  await page.getByRole('button', { name: '이번 요청에서 제외', exact: false }).click();
  await expect(page.locator('.result-grid')).not.toContainText(first!);
  await page.getByRole('button', { name: '되돌리기' }).click();
  await expect(page.locator('.result-grid')).toContainText(first!);
  await excludeCard(page);
  await page.getByRole('button', { name: '이번 요청에서 제외', exact: false }).click();
  await page.getByRole('button', { name: '새 요청 시작' }).click();
  await page.getByLabel('지금의 상황').fill('담백한 저녁');
  await page.getByRole('button', { name: '추천받기', exact: true }).click();
  await expect(page.locator('.result-grid')).toContainText(first!);
  await excludeCard(page);
  await page.getByRole('button', { name: '원래 내 취향이 아님', exact: false }).click();
  await expect(page.locator('.result-grid')).not.toContainText(first!);
  await page.getByRole('button', { name: '새 요청 시작' }).click();
  await page.getByLabel('지금의 상황').fill('담백한 저녁');
  await page.getByRole('button', { name: '추천받기', exact: true }).click();
  await expect(page.locator('.result-grid')).not.toContainText(first!);
  await page.reload();
  await page.getByRole('button', { name: '내 취향', exact: true }).click();
  await expect(page.getByRole('button', { name: `${first} 비선호 해제` })).toBeVisible();
  await page.getByRole('button', { name: `${first} 비선호 해제` }).click();
  await expect(page.getByRole('button', { name: `${first} 비선호 해제` })).toHaveCount(0);
});

test('independent music onboarding produces five songs and external links', async ({ page }) => {
  await page.goto('/'); await onboard(page, 'music');
  await page.getByLabel('지금의 상황').fill('과제할 때 보컬 없는 차분한 연주곡');
  await page.getByRole('button', { name: '추천받기', exact: true }).click();
  await expect(page.locator('.result-grid .item-card')).toHaveCount(5);
  await expect(page.locator('.result-grid')).not.toContainText('아이유');
  // Every song leads with a labelled listen button: its Apple Music song page when verified, otherwise a YouTube search.
  await expect(page.locator('.result-grid .listen-button')).toHaveCount(5);
  for (const link of await page.locator('.result-grid .listen-button').all()) {
    const label = await link.getAttribute('aria-label');
    if (label!.endsWith('Apple Music에서 듣기 (새 탭)')) await expect(link).toHaveAttribute('href', /^https:\/\/music\.apple\.com\/[a-z]{2}\/song\//);
    else expect(label).toMatch(/YouTube에서 검색 \(새 탭\)$/);
  }
  for (const link of await page.locator('.result-grid a').all()) await expect(link).toHaveAttribute('target', '_blank');
  await page.locator('.result-grid .select-button').first().click();
  await expect(page.getByRole('heading', { name: '선택을 기록했어요' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'YouTube에서 검색 (새 탭)' })).toHaveAttribute('target', '_blank');
  await page.getByRole('button', { name: '음식 추천', exact: true }).click();
  await expect(page.getByRole('heading', { name: '평소 좋아하는 음식을 골라주세요.' })).toBeVisible();
});

test('request failure allows retry and manual fallback', async ({ page }) => {
  await page.goto('/'); await onboard(page);
  await page.locator('.help-link').click();
  await page.getByRole('button', { name: '다음 추천 실패 체험하기' }).click();
  await page.getByRole('button', { name: '추천받기', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: '직접 선택한 조건으로 계속' }).click();
  await expect(page.locator('.result-grid .item-card')).toHaveCount(3);
  await page.getByRole('button', { name: '조건 수정', exact: true }).click();
  await page.locator('.help-link').click();
  await page.getByRole('button', { name: '다음 추천 실패 체험하기' }).click();
  await page.getByRole('button', { name: '추천받기', exact: true }).click();
  await page.getByRole('button', { name: '다시 시도하기' }).click();
  await expect(page.locator('.result-grid .item-card')).toHaveCount(3);
});

test('no eligible candidates, empty collections, and confirmed deletion', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '즐겨찾기', exact: true }).click();
  await expect(page.locator('.empty-state')).toBeVisible();
  await onboard(page);
  // Hard exclusions leave two candidates (토마토 파스타, 채소 카레), which can then be temporarily excluded.
  // 밀·유제품 are left out: the curry roux has both since the 2026-10-26 allergen review.
  const tags = ['매콤함','소고기','닭고기','생선','달걀','콩','버섯'];
  await openConditions(page);
  for (const tag of tags) await page.locator('.chip.exclude').filter({ hasText: new RegExp(`^${tag}$`) }).click();
  await page.getByRole('button', { name: '추천받기', exact: true }).click();
  await expect(page.locator('.notice.warning')).toBeVisible();
  await expect(page.locator('.result-grid .item-card')).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    await excludeCard(page);
    await page.getByRole('button', { name: '이번 요청에서 제외', exact: false }).click();
  }
  await expect(page.locator('.result-grid .item-card')).toHaveCount(0);
  await expect(page.locator('.notice.warning')).toContainText('지금 조건에 맞는 후보가 없어요.');
  await page.getByRole('button', { name: '추천 기록', exact: true }).click();
  await page.getByRole('button', { name: /기록 삭제/ }).click();
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.locator('.history-row')).toHaveCount(1);
  await page.getByRole('button', { name: /기록 삭제/ }).click();
  await page.getByRole('button', { name: '삭제하기', exact: true }).click();
  await expect(page.locator('.history-row')).toHaveCount(0);
});

test('mobile navigation and layout have no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.getByRole('navigation', { name: '하단 메뉴' })).toBeVisible();
  await page.getByRole('button', { name: '음식 추천', exact: true }).click();
  await expect(page.getByRole('heading', { name: '평소 좋아하는 음식을 골라주세요.' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/mobile-onboarding.png', fullPage: true, animations: 'disabled' });
});

test('desktop visual preview and no client errors', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await page.screenshot({ path: 'artifacts/home-desktop.png', fullPage: true, animations: 'disabled' });
  await onboard(page); await page.getByLabel('지금의 상황').fill('혼자 먹을 담백한 저녁');
  await page.getByRole('button', { name: '추천받기', exact: true }).click();
  await expect(page.locator('.result-grid .item-card')).toHaveCount(3);
  const dismiss = page.getByRole('button', { name: '알림 닫기' });
  if (await dismiss.isVisible()) await dismiss.click();
  await page.screenshot({ path: 'artifacts/results-desktop.png', fullPage: true, animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('one taste item is enough, editing can empty it, and liking a result adds to it', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '음악 추천', exact: true }).click();
  await expect(page.getByRole('button', { name: '저장하고 시작' })).toBeDisabled();
  await page.locator('.selection-card').first().click();
  await page.getByRole('button', { name: '저장하고 시작' }).click();
  await page.getByLabel('지금의 상황').fill('산책할 때 활기찬 음악');
  await page.getByRole('button', { name: '추천받기', exact: true }).click();
  await expect(page.locator('.result-grid .item-card')).toHaveCount(5);
  const song = (await page.locator('.result-grid h3').nth(1).textContent())!;
  await page.getByRole('button', { name: `${song} 더보기`, exact: true }).click();
  await page.getByRole('button', { name: `${song} 내 취향에 추가`, exact: true }).click();
  await expect(page.locator('.toast')).toContainText('내 취향에 추가했어요');
  await page.getByRole('button', { name: '내 취향', exact: true }).first().click();
  await expect(page.locator('.taste-panel').nth(1)).toContainText(song);
  await page.locator('.taste-panel').nth(1).getByRole('button', { name: '편집하기' }).click();
  const selected = page.locator('.selection-card.selected');
  await expect(selected).toHaveCount(2);
  while (await selected.count()) await selected.first().click();
  await page.getByRole('button', { name: '저장하기' }).click();
  await expect(page.locator('.taste-panel').nth(1)).toContainText('아직 좋아하는 항목이 없어요');
});

// 2026-10-27: "신나는 록" lost 록 without a word. Catalog genres are conditions now; genres without a tag are named.
test('music genres become conditions or are named as unsupported', async ({ page }) => {
  await page.goto('/#/recommend/music');
  await page.getByRole('button', { name: '취향 없이 바로 추천받기' }).click();
  await page.getByLabel('지금의 상황').fill('비 오는 날 과제할 때 듣는 신나는 록');
  await expect(page.locator('.condition-summary .chip')).toHaveText(['과제', '활기참', '록']);
  await page.getByLabel('지금의 상황').fill('힙합 노래 추천해줘');
  await expect(page.locator('.condition-note.unsupported')).toContainText('‘힙합’ 이 장르는 곡 정보에 분류가 없어 반영하지 못해요.');
  await page.getByLabel('지금의 상황').fill('기록 정리하면서 화면 락 걸고 들을 노래');
  await expect(page.locator('.condition-summary .chip')).toHaveCount(0);
  await expect(page.locator('.condition-note.unsupported')).toHaveCount(0);
});
