import {test,expect} from '@playwright/test';
import {createBackup} from '../src/backup';
import {emptyStore} from '../src/domain';
test('backup preview, invalid import preserves data, replacement and selective reset',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'브라우저 프로필',exact:true}).click();
  await page.getByLabel('백업 JSON 가져오기').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{')});await expect(page.getByRole('alert')).toContainText('JSON');
  const next={...emptyStore(),name:'가져온 사용자',favorites:['f01','m06']};
  await page.getByLabel('백업 JSON 가져오기').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(createBackup(next))});await expect(page.getByRole('dialog')).toContainText('즐겨찾기 2개');await expect(page.getByRole('dialog')).toContainText('현재 데이터 전체가 교체');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'현재 데이터 백업 후 전체 교체'}).click();expect((await download).suggestedFilename()).toContain('nowrecommend-backup');
  await expect(page.getByRole('dialog')).toHaveCount(0);await page.reload();expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('nowrecommend-prototype-v1')!).favorites)).toEqual(next.favorites);
  await page.getByRole('button',{name:'브라우저 프로필',exact:true}).click();await page.getByRole('button',{name:'즐겨찾기만 초기화',exact:true}).click();await page.getByRole('button',{name:'즐겨찾기 초기화 확인',exact:true}).click();expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('nowrecommend-prototype-v1')!).favorites)).toEqual([]);expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('nowrecommend-prototype-v1')!).name)).toBe(next.name);
});
test('failed replacement keeps original data and preview',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'브라우저 프로필',exact:true}).click();const original=await page.evaluate(()=>localStorage.getItem('nowrecommend-prototype-v1'));
  await page.getByLabel('백업 JSON 가져오기').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(createBackup({...emptyStore(),name:'교체 시도'}))});
  await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new Error('quota');};});await page.getByRole('button',{name:'현재 데이터 백업 후 전체 교체'}).click();await expect(page.getByRole('alert')).toContainText('기존 데이터는 유지');expect(await page.evaluate(()=>localStorage.getItem('nowrecommend-prototype-v1'))).toBe(original);
});
