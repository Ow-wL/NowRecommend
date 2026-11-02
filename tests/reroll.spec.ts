import { test, expect } from '@playwright/test';
test('rerolls prioritize unseen items and explain exhaustion',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'음식 추천',exact:true}).click();await page.getByRole('button',{name:'취향 추가',exact:true}).click();
  for(let i=0;i<5;i++) await page.locator('.selection-card').nth(i).click();
  await page.getByRole('button',{name:'저장하고 시작'}).click();
  await page.getByRole('button',{name:/추천받기$/}).click();
  const first=await page.locator('.result-grid h3').allTextContents();
  await page.getByRole('button',{name:'같은 조건으로 다시 추천',exact:true}).click();
  const second=await page.locator('.result-grid h3').allTextContents();
  expect(second.some(n=>first.includes(n))).toBe(false);
  await page.reload();await expect(page.locator('.result-grid h3')).toHaveText(second);
  for(let i=0;i<4;i++) await page.getByRole('button',{name:'같은 조건으로 다시 추천',exact:true}).click();
  await expect(page.getByText('새 후보 1개 + 이전 후보 2개',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'같은 조건으로 다시 추천',exact:true}).click();
  await expect(page.getByText('새로운 후보를 모두 살펴봤어요.',{exact:true})).toBeVisible();
});
