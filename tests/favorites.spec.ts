import {test,expect} from '@playwright/test';
import {cardTool} from './ui';
test('favorite search, latest order, detail return and restricted recommendations',async({page})=>{
  await page.addInitScript(()=>{if(!localStorage.getItem('nowrecommend-prototype-v1'))localStorage.setItem('nowrecommend-prototype-v1',JSON.stringify({version:2,name:'검증',profiles:{food:{selected:['f01','f02','f03','f04','f05'],tags:[],disliked:[]},music:{selected:['m01','m02','m03','m04','m05'],tags:[],disliked:[]}},favorites:['f01','f02','m06'],history:[]}));});
  await page.goto('/#/favorites');await expect(page.locator('.collection-grid h3').first()).toHaveText('River Flows in You');await page.getByLabel('즐겨찾기 검색').fill('이루마');await expect(page.locator('.collection-grid h3')).toHaveCount(1);
  await page.getByRole('button',{name:'River Flows in You 상세 보기'}).click();await expect(page.getByRole('dialog')).toContainText('아티스트');await expect(page.getByRole('dialog').getByRole('link')).toHaveAttribute('target','_blank');await page.keyboard.press('Escape');await expect(page.getByLabel('즐겨찾기 검색')).toHaveValue('이루마');
  await page.getByRole('button',{name:'즐겨찾기 필터 초기화'}).click();await page.getByRole('button',{name:'저장한 음식에서 추천 (2개)',exact:true}).click();await page.getByRole('button',{name:'추천받기',exact:true}).click();await expect(page.locator('.result-grid h3')).toHaveCount(2);await expect(page.locator('.result-grid')).toContainText('닭곰탕');await page.reload();await expect(page.locator('.result-grid h3')).toHaveCount(2);
  const before=await page.locator('.result-grid h3').allTextContents();await cardTool(page,before[0],'한 장 교체');await expect(page.getByRole('status')).toContainText('교체할 새로운 후보가 없어요.');expect(await page.locator('.result-grid h3').allTextContents()).toEqual(before);
  await page.getByRole('button',{name:'전체 후보로 전환'}).click();await page.getByRole('button',{name:'추천받기',exact:true}).click();await expect(page.locator('.result-grid h3')).toHaveCount(3);
});
