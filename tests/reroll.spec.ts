import { test, expect } from '@playwright/test';
test('rerolls prioritize unseen items and explain exhaustion',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'음식 추천',exact:true}).click();
  for(let i=0;i<5;i++) await page.locator('.selection-card').nth(i).click();
  await page.getByRole('button',{name:'취향 요약 확인'}).click();await page.getByRole('button',{name:'확인하고 저장'}).click();
  await page.getByRole('button',{name:'조건 확인하기'}).click();await page.getByRole('button',{name:'추천받기',exact:true}).click();
  const first=await page.locator('.result-grid h3').allTextContents();
  await page.getByRole('button',{name:'다른 추천 보기',exact:true}).click();
  const second=await page.locator('.result-grid h3').allTextContents();
  expect(second.some(n=>first.includes(n))).toBe(false);
  await page.reload();await expect(page.locator('.result-grid h3')).toHaveText(second);
  for(let i=0;i<4;i++) await page.getByRole('button',{name:'다른 추천 보기',exact:true}).click();
  await expect(page.getByText('새 후보 1개 + 이전 후보 2개',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'다른 추천 보기',exact:true}).click();
  await expect(page.getByText('새로운 후보를 모두 살펴봤어요.',{exact:true})).toBeVisible();
});
