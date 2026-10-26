import {test,expect} from '@playwright/test';
import {cardTool,openCardMenu} from './ui';
for(const width of [390,1440])test(`pin, replace, compare and choose at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});await page.addInitScript(()=>{if(!localStorage.getItem('nowrecommend-prototype-v1'))localStorage.setItem('nowrecommend-prototype-v1',JSON.stringify({version:2,name:'검증',profiles:{food:{selected:['f01','f02','f03','f04','f05'],tags:[],disliked:[]},music:{selected:['m01','m02','m03','m04','m05'],tags:[],disliked:[]}},favorites:[],history:[]}));});
  await page.goto('/#/recommend/food');await page.getByRole('button',{name:'추천받기',exact:true}).click();
  const first=await page.locator('.result-grid h3').allTextContents();await cardTool(page,first[0],'이번 요청 고정');await openCardMenu(page,first[0]);await expect(page.getByRole('button',{name:`${first[0]} 한 장 교체`})).toBeDisabled();await page.keyboard.press('Escape');
  await cardTool(page,first[1],'한 장 교체');const next=await page.locator('.result-grid h3').allTextContents();expect(next[0]).toBe(first[0]);expect(next[2]).toBe(first[2]);expect(next[1]).not.toBe(first[1]);
  await page.reload();await expect(page.locator('.item-card.pinned h3')).toHaveText(first[0]);await openCardMenu(page,first[0]);await expect(page.getByRole('button',{name:`${first[0]} 이번 요청 고정`})).toHaveAttribute('aria-pressed','true');await page.keyboard.press('Escape');
  for(const name of next)await cardTool(page,name,'비교 항목');await page.getByRole('button',{name:'선택한 후보 비교',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('평소 취향');await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`artifacts/extensions-compare-${width}.png`});await page.getByRole('dialog').getByRole('button',{name:`${first[0]} 선택하고 기록`,exact:true}).click();await expect(page.getByRole('heading',{name:'선택을 기록했어요'})).toBeVisible();
});
test('music comparisons stop at three and pinned cards survive reroll',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('nowrecommend-prototype-v1',JSON.stringify({version:2,name:'검증',profiles:{food:{selected:[],tags:[],disliked:[]},music:{selected:['m01','m02','m03','m04','m05'],tags:[],disliked:[]}},favorites:[],history:[]})));
  await page.goto('/#/recommend/music');await page.getByRole('button',{name:'추천받기',exact:true}).click();const names=await page.locator('.result-grid h3').allTextContents();
  for(const name of names.slice(0,3))await cardTool(page,name,'비교 항목');await openCardMenu(page,names[3]);await expect(page.getByRole('button',{name:`${names[3]} 비교 항목`,exact:true})).toBeDisabled();await page.keyboard.press('Escape');
  for(const name of names)await cardTool(page,name,'이번 요청 고정');await expect(page.getByRole('button',{name:'다른 추천 보기',exact:true})).toBeDisabled();await cardTool(page,names[4],'이번 요청 고정');await page.getByRole('button',{name:'다른 추천 보기',exact:true}).click();for(const name of names.slice(0,4))await expect(page.locator('.result-grid')).toContainText(name);await expect(page.locator('.result-grid')).not.toContainText(names[4]);
});
