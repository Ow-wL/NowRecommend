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
test('an unpicked taste card shows an empty ring, and only a picked one shows a check',async({page})=>{
  await page.goto('/#/recommend/food');await page.getByRole('button',{name:'취향 추가',exact:true}).click();
  const card=page.locator('.selection-card').first();await expect(card.locator('.selection-check svg')).toHaveCount(0);await expect(card).toHaveAttribute('aria-pressed','false');
  await card.click();await expect(card.locator('.selection-check svg')).toHaveCount(1);await expect(card).toHaveAttribute('aria-pressed','true');
});
test('the mood picker opens in place, in view and above the save bar',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/#/recommend/music');await page.getByRole('button',{name:'취향 추가',exact:true}).click();
  const open=page.locator('.to-moods');await expect(open).toHaveAttribute('aria-expanded','false');await expect(page.locator('#taste-moods')).toHaveCount(0);
  await open.click();await expect(open).toHaveAttribute('aria-expanded','true');
  const chip=page.locator('#taste-moods .chip').first();await expect(chip).toBeFocused();
  const [c,bar,head]=await Promise.all([chip.boundingBox(),page.locator('.action-bar-inner').boundingBox(),page.locator('.appbar').boundingBox()]);
  expect(c!.y).toBeGreaterThanOrEqual(head!.y+head!.height);expect(c!.y+c!.height).toBeLessThanOrEqual(bar!.y);
  await chip.click();await expect(open).toContainText('1개');await page.getByRole('button',{name:'저장하고 시작'}).click();await expect(page.getByLabel('지금의 상황')).toBeVisible();
});
test('the heart keeps clear of the text on the wide music row',async({page})=>{
  await page.setViewportSize({width:1280,height:800});await page.goto('/#/recommend/music');await page.getByRole('button',{name:/추천받기$/}).click();
  const first=page.locator('.result-grid .item-card').first();const [heart,lead]=await Promise.all([first.locator('.save-button').boundingBox(),first.locator('.lead').boundingBox()]);
  expect(lead!.x+lead!.width).toBeLessThanOrEqual(heart!.x);
});
for(const width of [320,360,390])test(`music actions stay on one line each at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:800});await page.goto('/#/recommend/music');await page.getByRole('button',{name:/추천받기$/}).click();
  const sizes=await page.locator('.result-grid .card-actions .button:not(.more-toggle)').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height));
  expect(sizes.length).toBeGreaterThan(0);sizes.forEach(h=>expect(h).toBeLessThanOrEqual(48));
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const brokenWords=await page.locator('.result-grid h3').evaluateAll(titles=>titles.flatMap(h=>{const text=h.firstChild as Text;let at=0;return text.data.split(/\s+/).filter(word=>{const start=text.data.indexOf(word,at);at=start+word.length;const range=document.createRange();range.setStart(text,start);range.setEnd(text,at);return new Set([...range.getClientRects()].map(r=>Math.round(r.top))).size>1;});}));
  expect(brokenWords).toEqual([]);
  await page.locator('.result-grid').evaluate(grid=>Promise.all(grid.getAnimations({subtree:true}).map(a=>a.finished)));  // cards rise one by one (DESIGN.md §0.2)
  const {heart,more,listen}=await page.locator('.result-grid .item-card').first().evaluate(card=>{const box=(sel:string)=>card.querySelector(sel)!.getBoundingClientRect();return {heart:box('.save-button').toJSON(),more:box('.more-toggle').toJSON(),listen:box('.listen-button').toJSON()};});  // measured together: the cards rise in as they appear
  expect(heart.y).toBeCloseTo(more.y,0);expect(more.x+more.width).toBeLessThanOrEqual(heart.x);expect(heart.height).toBeGreaterThanOrEqual(44);expect(listen.width).toBeGreaterThanOrEqual(170);
  await page.locator('.result-grid .more-toggle').first().click();await expect(page.locator('.more-menu')).toBeVisible();const menu=await page.locator('.more-menu').boundingBox();expect(menu!.x).toBeGreaterThanOrEqual(0);expect(menu!.x+menu!.width).toBeLessThanOrEqual(width);
});
test('the taste type test gives a code by questions, and asks for recommendations in its words',async({page})=>{
  await page.goto('/#/type');await page.getByRole('button',{name:'테스트 시작'}).click();
  for(let i=0;i<8;i++){await expect(page.locator('.type-question small')).toHaveText(`${i+1} / 8`);await page.locator('.type-choice').first().click();}
  await expect(page.locator('.type-result h2')).toContainText('혼밥 국밥 장인');await expect(page.locator('.type-result h2')).toBeFocused();
  await page.reload();await expect(page.locator('.type-result h2')).toContainText('혼밥 국밥 장인');
  await page.getByRole('button',{name:/이 유형으로 추천받기/}).click();
  await expect(page.getByLabel('지금의 상황')).toHaveValue(/얼큰하고 자극적인 맛/);await expect(page.locator('.condition-summary .chip')).toContainText(['매콤함']);
});
