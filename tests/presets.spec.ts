import {test,expect} from '@playwright/test';
import {emptyStore} from '../src/domain';
import {openConditions} from './ui';
test('preview, save, rename, reload and delete independent condition presets',async({page})=>{
  await page.addInitScript(()=>{if(!localStorage.getItem('nowrecommend-prototype-v1'))localStorage.setItem('nowrecommend-prototype-v1',JSON.stringify({version:2,name:'검증',profiles:{food:{selected:['f01','f02','f03','f04','f05'],tags:[],disliked:[]},music:{selected:[],tags:[],disliked:[]}},favorites:[],history:[]}));});
  await page.goto('/');await page.getByRole('button',{name:'혼자 먹는 따뜻한 점심',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.toast')).toContainText('선택한 조건을 적용했어요');
  await expect(page.getByLabel('참고 예산 상한')).toHaveCount(0);await expect(page.locator('.condition-summary .chip')).toHaveText(['점심','혼자','따뜻함']);await openConditions(page);await page.getByRole('button',{name:'현재 조건을 프리셋으로 저장'}).click();await page.getByLabel('프리셋 이름',{exact:true}).fill('내 점심');await page.getByRole('button',{name:'프리셋 저장',exact:true}).click();
  await page.getByRole('button',{name:'내 점심 이름 변경',exact:true}).click();await page.getByLabel('새 프리셋 이름').fill('가벼운 점심');await page.getByRole('button',{name:'이름 저장'}).click();
  await page.reload();await openConditions(page);await expect(page.getByRole('button',{name:'가벼운 점심',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'가벼운 점심 프리셋 삭제',exact:true}).click();await expect(page.getByRole('button',{name:'가벼운 점심',exact:true})).toHaveCount(0);
  const store=await page.evaluate(()=>JSON.parse(localStorage.getItem('nowrecommend-prototype-v1')!));expect(store.profiles.music).toEqual(emptyStore().profiles.music);expect(store.presets).toEqual([]);
});
test('a quick condition asks only when it would replace something, can be undone, and names the request',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'집중하는 연주곡',exact:true}).click();
  await expect(page.locator('.condition-summary .chip')).toHaveCount(4);
  await page.locator('.toast').getByRole('button',{name:'되돌리기'}).click();await expect(page.locator('.condition-summary .chip')).toHaveCount(0);
  await page.getByLabel('지금의 상황').fill('비 오는 밤');await page.getByRole('button',{name:'지금 추천 홈',exact:true}).click();
  await page.getByRole('button',{name:'집중하는 연주곡',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('작성 중인 조건을 ‘집중하는 연주곡’으로 바꿀까요?');await page.getByRole('button',{name:'이 조건 적용'}).click();
  await page.getByRole('button',{name:/추천받기$/}).click();await expect(page.locator('h1')).toHaveText('집중하는 연주곡');
  await page.getByRole('button',{name:'지금 추천 홈',exact:true}).click();await expect(page.locator('.resume-copy')).toContainText('집중하는 연주곡');
  await page.getByRole('button',{name:'이어서 보기'}).click();await page.getByRole('button',{name:'조건 바꾸기'}).click();await page.locator('.condition-summary .chip').first().click();
  await page.getByRole('button',{name:/추천받기$/}).click();await expect(page.locator('h1')).toHaveText('고른 조건에 맞춘 음악');
});
test('a result title never claims a taste that is not registered',async({page})=>{
  await page.goto('/#/recommend/music');await page.getByRole('button',{name:/추천받기$/}).click();await expect(page.locator('h1')).toHaveText('지금 만나볼 음악');
});
