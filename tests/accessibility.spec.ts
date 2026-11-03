import { test,expect } from '@playwright/test';
import { emptyStore } from '../src/domain';
import { openConditions } from './ui';
const seed = {...emptyStore(),profiles:{food:{selected:['f01','f02','f03','f04','f05'],tags:['담백함'],disliked:[]},music:{selected:['m01','m02','m03','m04','m05'],tags:['차분함'],disliked:[]}}};
for(const width of [320,360,390,768,1024,1440]){
  test(`responsive light states and keyboard flow at ${width}`,async({page})=>{
    test.setTimeout(60000);
    await page.setViewportSize({width,height:width < 640 ? 844 : 900});
    await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
    await page.route('https://fonts.googleapis.com/**',route=>route.abort());
    await page.route('https://fonts.gstatic.com/**',route=>route.abort());
    await page.route('https://cdn.jsdelivr.net/**',route=>route.abort());  // Pretendard: layout must hold with fallback fonts
    await page.addInitScript(value=>localStorage.setItem('nowrecommend-prototype-v1',JSON.stringify(value)),seed);
    await page.goto('/');
    await expect(page.locator('body')).toHaveCSS('background-color','rgb(247, 245, 240)');
    await expect(page.locator('h1')).toBeFocused();
    const overflow=()=>expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await overflow();
    // Below 900px the top navigation becomes a bottom tab bar with the same accessible names.
    const tabbar=page.getByRole('navigation',{name:'하단 메뉴'}),topnav=page.getByRole('navigation',{name:'주요 메뉴'});
    if(width<900){
      await expect(tabbar).toBeVisible();await expect(topnav).toBeHidden();
      await expect(tabbar.getByRole('button',{name:'홈',exact:true})).toHaveAttribute('aria-current','page');
    } else {
      await expect(topnav).toBeVisible();await expect(tabbar).toBeHidden();
    }
    await page.getByRole('button',{name:'음식 추천',exact:true}).click();
    await expect(page.locator('h1')).toBeFocused();
    await page.getByLabel('지금의 상황').fill('담백한 저녁, 15,000원 이하로');
    await overflow();
    await page.screenshot({path:`artifacts/light-input-${width}-default.png`,fullPage:true});
    await page.getByRole('button',{name:/추천받기$/}).click();await expect(page.locator('h1')).toBeFocused();await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0);
    await overflow();
    // The exclude action lives in the card's menu; closing the dialog returns focus to the menu button.
    const feedback=page.locator('.result-grid .more-toggle').first();await feedback.click();
    await page.keyboard.press('Escape');await expect(feedback).toBeFocused();await expect(page.locator('.more-menu')).toHaveCount(0);
    await feedback.click();await page.locator('.more-menu .feedback-button').click();
    await expect(page.locator('.main-content')).toHaveAttribute('inert','');
    await page.keyboard.press('Shift+Tab');await expect(page.getByRole('button',{name:'취소',exact:true})).toBeFocused();
    await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'닫기',exact:true})).toBeFocused();
    await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`artifacts/light-feedback-${width}-default.png`,fullPage:true});
    await page.keyboard.press('Escape');await expect(feedback).toBeFocused();
    await page.locator('.result-grid .select-button').first().click();
    await expect(page.locator('h1')).toBeFocused();await overflow();
    await page.screenshot({path:`artifacts/light-complete-${width}-default.png`,fullPage:true});
    await page.getByRole('button',{name:'즐겨찾기',exact:true}).click();await overflow();
    await page.screenshot({path:`artifacts/light-empty-${width}-favorites.png`,fullPage:true});
  });
}
test('200 percent text, long names, minimum controls and actual contrast',async({page})=>{
  await page.setViewportSize({width:720,height:450});
  await page.addInitScript(value=>localStorage.setItem('nowrecommend-prototype-v1',JSON.stringify(value)),seed);
  await page.goto('/#/recommend/food');
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  await page.getByRole('button',{name:/추천받기$/}).click();
  await page.evaluate(()=>{document.querySelector('.result-grid h3')!.textContent='아주 긴 한글 메뉴 이름과 영어 제목 A Very Long Recommendation Name';});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('.result-grid .more-toggle').first().click();
  for(const selector of ['.save-button','.more-menu button','.card-actions button']){
    const heights=await page.locator(selector).evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height));heights.forEach(h=>expect(h).toBeGreaterThanOrEqual(44));
  }
  const tokens=await page.evaluate(()=>{const s=getComputedStyle(document.documentElement);return Object.fromEntries(['--text-primary','--text-secondary','--text-muted','--text-on-accent','--bg-surface','--bg-elevated','--bg-hover','--accent','--border-control','--focus'].map(k=>[k,s.getPropertyValue(k).trim()]));});
  const luminance=(hex:string)=>{const values=hex.replace('#','').match(/../g)!.map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return values[0]*.2126+values[1]*.7152+values[2]*.0722;};
  const ratio=(a:string,b:string)=>{const x=luminance(tokens[a]),y=luminance(tokens[b]);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  for(const [a,b] of [['--text-primary','--bg-surface'],['--text-secondary','--bg-elevated'],['--text-muted','--bg-hover'],['--text-on-accent','--accent']])expect(ratio(a,b)).toBeGreaterThanOrEqual(4.5);
  expect(ratio('--border-control','--bg-surface')).toBeGreaterThanOrEqual(3);expect(ratio('--focus','--bg-elevated')).toBeGreaterThanOrEqual(3);
  await page.screenshot({path:'artifacts/light-food-720-zoom-long.png',fullPage:true});
  await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>{document.documentElement.style.fontSize='16px';document.body.style.zoom='2';});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'artifacts/light-food-1440-zoom-200.png',fullPage:true});
});
test('refused storage is visible and destructive modal starts on cancel',async({page})=>{
  await page.addInitScript(value=>{localStorage.setItem('nowrecommend-prototype-v1',JSON.stringify(value));Storage.prototype.setItem=()=>{throw new Error('quota');};},seed);
  await page.goto('/#/recommend/food');
  await page.getByRole('button',{name:/추천받기$/}).click();
  await page.locator('.save-button').first().click();await expect(page.locator('.save-button').first()).toContainText('임시 저장');
  await expect(page.getByRole('button',{name:'저장 재시도'})).toBeVisible();
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'artifacts/light-storage-1440-error.png',fullPage:true});
  await page.getByRole('button',{name:'브라우저 프로필',exact:true}).click();await page.getByRole('button',{name:'데이터 관리',exact:true}).click();await page.getByRole('button',{name:'이 브라우저의 데이터 모두 초기화'}).click();
  await expect(page.getByRole('button',{name:'취소',exact:true})).toBeFocused();await page.keyboard.press('Escape');
});
test('Enter, Space and rendered hover, pressed, focus and disabled controls',async({page})=>{
  await page.addInitScript(value=>localStorage.setItem('nowrecommend-prototype-v1',JSON.stringify(value)),seed);
  await page.goto('/');await page.getByRole('button',{name:'음식 추천',exact:true}).focus();await page.keyboard.press('Enter');
  await openConditions(page);
  const chip=page.getByRole('button',{name:'담백함',exact:true});await chip.focus();await page.keyboard.press('Space');await expect(chip).toHaveAttribute('aria-pressed','true');
  const next=page.getByRole('button',{name:/추천받기$/});await next.focus();await expect(next).toHaveCSS('outline-color','rgb(29, 27, 24)');
  await next.hover();await expect(next).toHaveCSS('background-color','rgb(189, 56, 19)');
  await page.mouse.down();await expect(next).toHaveCSS('background-color','rgb(165, 48, 15)');await page.mouse.up();
  const save=page.locator('.save-button').first();await save.focus();await page.keyboard.press('Space');await expect(save).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'조건 바꾸기',exact:true}).click();await openConditions(page);
  // A conflict (매콤함 wanted and excluded) is now what disables the button; there is no budget input any more.
  await page.locator('.more-conditions .chip:not(.exclude)').filter({hasText:/^매콤함$/}).click();await page.locator('.chip.exclude').filter({hasText:/^매콤함$/}).click();
  await expect(page.getByRole('button',{name:/추천받기$/})).toBeDisabled();await expect(page.getByRole('button',{name:/추천받기$/})).toHaveCSS('background-color','rgb(238, 234, 226)');
});
test('keyboard focus stays visible, clear of the sticky bars, and is not lost',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/#/home');await page.getByRole('button',{name:'담백한 저녁',exact:true}).focus();await page.keyboard.press('Enter');
  await page.locator('.toast').getByRole('button',{name:'되돌리기'}).focus();await page.keyboard.press('Enter');
  await expect(page.locator('.toast')).toHaveCount(0);await expect(page.locator('#main-content')).toBeFocused();
  await page.goto('/#/recommend/food');await page.locator('.compose-panel textarea').focus();
  await expect(page.locator('.compose-panel')).toHaveCSS('outline-style','solid');
  await openConditions(page);await page.locator('.more-conditions > summary').focus();
  for(let i=0;i<20;i++){
    await page.keyboard.press('Tab');
    const clear=await page.evaluate(()=>{const el=document.activeElement as HTMLElement,r=el.getBoundingClientRect(),top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!top&&(el===top||el.contains(top)||top.contains(el));});
    expect(clear,await page.evaluate(()=>document.activeElement?.textContent)).toBe(true);
  }
  await page.getByLabel('지금의 상황').fill('따뜻한 저녁');await page.getByRole('button',{name:/추천받기$/}).click();
  const toggle=page.locator('.result-grid .more-toggle').first();await toggle.focus();await page.keyboard.press('Enter');await expect(page.locator('.more-menu')).toBeVisible();
  for(let i=0;i<12&&await page.locator('.more-menu').count();i++)await page.keyboard.press('Tab');
  await expect(page.locator('.more-menu')).toHaveCount(0);await expect(toggle).not.toBeFocused();
});
test('small text on the coloured doors stays fully opaque',async({page})=>{
  await page.goto('/#/home');await expect(page.locator('.door.food small')).toHaveCSS('opacity','1');await expect(page.locator('.door.food small')).toHaveCSS('color','rgb(255, 255, 255)');
});
test('a custom colour as light as the surface still shows focus and button edges',async({page})=>{
  await page.addInitScript(value=>localStorage.setItem('nowrecommend-prototype-v1',JSON.stringify(value)),{...seed,appearance:{mode:'light',accent:'#ffffff'}});
  await page.goto('/#/recommend/food');await page.locator('.compose-panel textarea').focus();
  const outline=await page.locator('.compose-panel').evaluate(n=>getComputedStyle(n).outlineColor);expect(outline).not.toBe('rgb(255, 255, 255)');
  await expect(page.locator('.action-bar .button.primary')).not.toHaveCSS('box-shadow','none');
});
