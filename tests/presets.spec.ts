import {test,expect} from '@playwright/test';
import {emptyStore} from '../src/domain';
test('preview, save, rename, reload and delete independent condition presets',async({page})=>{
  await page.addInitScript(()=>{if(!localStorage.getItem('nowrecommend-prototype-v1'))localStorage.setItem('nowrecommend-prototype-v1',JSON.stringify({version:2,name:'검증',profiles:{food:{selected:['f01','f02','f03','f04','f05'],tags:[],disliked:[]},music:{selected:[],tags:[],disliked:[]}},favorites:[],history:[]}));});
  await page.goto('/');await page.getByRole('button',{name:'만원 이하 점심',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('10,000원 이하');await page.getByRole('button',{name:'이 조건 적용'}).click();
  await expect(page.getByLabel('참고 예산 상한')).toHaveValue('10000');await page.getByRole('button',{name:'현재 조건을 프리셋으로 저장'}).click();await page.getByLabel('프리셋 이름',{exact:true}).fill('내 점심');await page.getByRole('button',{name:'프리셋 저장',exact:true}).click();
  await page.getByRole('button',{name:'내 점심 이름 변경',exact:true}).click();await page.getByLabel('새 프리셋 이름').fill('가벼운 점심');await page.getByRole('button',{name:'이름 저장'}).click();
  await page.reload();await expect(page.getByRole('button',{name:'가벼운 점심',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'가벼운 점심 프리셋 삭제',exact:true}).click();await expect(page.getByRole('button',{name:'가벼운 점심',exact:true})).toHaveCount(0);
  const store=await page.evaluate(()=>JSON.parse(localStorage.getItem('nowrecommend-prototype-v1')!));expect(store.profiles.music).toEqual(emptyStore().profiles.music);expect(store.presets).toEqual([]);
});
