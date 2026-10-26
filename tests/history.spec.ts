import { test,expect } from '@playwright/test';
test('selection completion, refresh, change, cancel and historical snapshots',async({page})=>{
  test.setTimeout(60000);
  await page.goto('/');await page.getByRole('button',{name:'음식 추천',exact:true}).click();
  for(let i=0;i<5;i++) await page.locator('.selection-card').nth(i).click();
  await page.getByRole('button',{name:'저장하고 시작'}).click();
  await page.getByLabel('지금의 상황').fill('담백한 저녁');await page.getByRole('button',{name:'추천받기',exact:true}).click();
  await page.getByRole('button',{name:'다른 추천 보기',exact:true}).click();
  const name=await page.locator('.result-grid h3').first().textContent();
  await page.locator('.result-grid .select-button').first().dblclick();
  await expect(page.getByRole('heading',{name:'선택을 기록했어요'})).toBeVisible();
  await page.reload();await expect(page.locator('.completion-panel')).toContainText(name!);
  await page.getByRole('button',{name:'홈',exact:true}).click();await expect(page.getByRole('button',{name:'이어서 추천받기'})).toHaveCount(0);
  await expect(page.locator('.recent-choice')).toContainText(name!);
  await page.getByRole('button',{name:'추천 기록',exact:true}).click();await expect(page.locator('.history-row')).toHaveCount(1);
  await page.locator('.history-title').click();await expect(page.locator('.history-round')).toHaveCount(2);
  const before=await page.locator('.history-round').first().textContent();
  await page.getByRole('button',{name:'이 항목으로 선택 변경',exact:true}).first().click();
  await expect(page.getByRole('button',{name:'선택됨',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'선택 취소',exact:true}).click();await expect(page.getByRole('button',{name:'선택 취소',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'닫기',exact:true}).click();
  await page.getByRole('button',{name:'내 취향',exact:true}).click();await page.getByRole('button',{name:'편집하기',exact:true}).first().click();
  await page.getByRole('button',{name:'매콤함',exact:true}).click();await page.getByRole('button',{name:'저장하기'}).click();
  await page.getByRole('button',{name:'추천 기록',exact:true}).click();await page.locator('.history-title').click();
  await expect(page.locator('.history-round').first()).toHaveText(before!);
});
test('legacy records survive migration and damaged data is not silently overwritten',async({page})=>{
  await page.addInitScript(()=>{ if (!localStorage.getItem('nowrecommend-prototype-v1')) localStorage.setItem('nowrecommend-prototype-v1',JSON.stringify({version:1,name:'기존 사용자',profiles:{food:{selected:[],tags:[],disliked:[]},music:{selected:[],tags:[],disliked:[]}},favorites:['f01'],history:[{id:'old',date:'2026-10-01T00:00:00Z',category:'food',raw:'예전 추천',conditions:{tags:[],excluded:[],maxPrice:null},resultIds:['f01']}]})); });
  await page.goto('/#/history');await page.locator('.history-title').click();await expect(page.getByRole('dialog')).toContainText('이전 버전 기록에는 추천 이유가 없어요.');
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('nowrecommend-prototype-v1')!).version)).toBe(2);
  expect(await page.evaluate(()=>localStorage.getItem('nowrecommend-prototype-v1-backup'))).not.toBeNull();
  await page.getByRole('button',{name:'닫기',exact:true}).click();await page.evaluate(()=>localStorage.setItem('nowrecommend-prototype-v1','{broken'));
  // Navigate without re-running the legacy init script.
  await page.evaluate(()=>location.reload());await expect(page.getByText('저장된 데이터가 손상되어 원본을 보호하고 있어요.')).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('nowrecommend-prototype-v1'))).toBe('{broken');
});

test('a request saved with a budget re-recommends without it and shows no price anywhere',async({page})=>{
  const item={id:'f02',category:'food',name:'닭곰탕',subtitle:'9,000–11,000원',description:'국물',tags:['담백함','따뜻함','혼자','저녁','국물'],ingredients:['닭고기'],emoji:'',color:'#e9efdf',price:'9,000–11,000원',cost:10000};
  const result={item,tasteReason:'좋아하는 담백함에 가까워요',contextReason:'이번에 고른 혼자 · 저녁에 어울려요'};
  const conditions={tags:['혼자','저녁'],excluded:[],maxPrice:10000};
  const old={version:2,name:'기존 사용자',profiles:{food:{selected:['f01'],tags:[],disliked:[]},music:{selected:[],tags:[],disliked:[]}},favorites:['f02'],
    presets:[{id:'p1',category:'food',name:'예전 점심',conditions:{tags:['점심'],excluded:[],maxPrice:10000}}],
    history:[{id:'h1',date:'2026-10-20T03:00:00Z',category:'food',raw:'혼자 먹을 만원 이하 저녁',conditions,resultIds:['f02'],rounds:[{id:'r1',date:'2026-10-20T03:00:00Z',raw:'혼자 먹을 만원 이하 저녁',conditions,results:[result],feedback:[],excludedIds:[]}],selected:{result,date:'2026-10-20T03:01:00Z',roundId:'r1'}}]};
  await page.addInitScript(v=>{if(!localStorage.getItem('nowrecommend-prototype-v1'))localStorage.setItem('nowrecommend-prototype-v1',JSON.stringify(v));},old);
  await page.goto('/#/history');
  await expect(page.locator('.history-row')).toContainText('혼자 먹을 만원 이하 저녁'); // the sentence is kept as written
  await page.locator('.history-title').click();
  const dialog=page.getByRole('dialog');
  await expect(dialog).toContainText('가격 조건은 지원하지 않아 다시 추천할 때 적용하지 않아요.');
  await expect(dialog.locator('.mini-tags').first()).not.toContainText('원');
  await expect(dialog).not.toContainText('9,000');
  await dialog.getByRole('button',{name:'같은 조건으로 다시 추천'}).click();
  await expect(page.locator('.condition-summary .chip')).toHaveText(['혼자','저녁']);
  await expect(page.locator('.condition-note.unsupported')).toContainText('‘만원 이하’ 가격 조건은 지원하지 않아요.');
  await page.getByRole('button',{name:'추천받기',exact:true}).click();
  await expect(page.locator('.result-grid .item-card')).toHaveCount(3);
  await expect(page.locator('main')).not.toContainText('참고 가격');
  const stored=await page.evaluate(()=>localStorage.getItem('nowrecommend-prototype-v1')!);
  expect(stored).not.toMatch(/maxPrice|"price"|"cost"/); // migrated on load; favourites and history kept
  expect(JSON.parse(stored).favorites).toEqual(['f02']);
});
