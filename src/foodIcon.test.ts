import { expect, it } from 'vitest';
import { items } from './data';
import { foodIcon } from './foodIcon';

const folder = (src: string) => decodeURIComponent(src.split('/assets/')[1].split('/3D/')[0]);

it('gives every bundled dish a pinned 3D icon and a tile hue', () => {
  for (const item of items.filter(i => i.category === 'food')) {
    const icon = foodIcon(item);
    expect(icon.src).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/gh\/microsoft\/fluentui-emoji@[0-9a-f]{40}\/assets\/.+_3d\.png$/);
    expect(icon.hue).toMatch(/^#[0-9A-F]{6}$/);
  }
});
it('tints by dish, so dishes sharing an icon can differ, and the same dish never changes', () => {
  const hues = items.filter(i => i.category === 'food').map(i => foodIcon(i).hue);
  expect(new Set(hues).size).toBe(4);
  expect(foodIcon({ id: 'f01', name: '쌀국수' }).hue).not.toBe(foodIcon({ id: 'f09', name: '우동' }).hue);
  expect(foodIcon({ id: 'f01', name: '쌀국수' }).hue).toBe(foodIcon({ id: 'f01', name: '다른 이름' }).hue);
});
it('builds the file name from the folder name', () => {
  expect(foodIcon({ emoji: '🍜', name: '쌀국수' }).src).toContain('/Steaming%20bowl/3D/steaming_bowl_3d.png');
});
it('replaces emoji that would show the wrong object', () => {
  expect(folder(foodIcon({ emoji: '🐔', name: '삼계탕' }).src)).toBe('Pot of food');
  expect(folder(foodIcon({ id: 'f07', emoji: '🥗', name: '비빔밥' }).src)).toBe('Cooked rice');
});
it('reads the dish name when an AI pick has no usable emoji', () => {
  expect(folder(foodIcon({ emoji: '✨', name: '차돌 된장찌개' }).src)).toBe('Pot of food');
  expect(folder(foodIcon({ name: '명란 파스타' }).src)).toBe('Spaghetti');
  expect(folder(foodIcon({ name: '뿌링클 치킨' }).src)).toBe('Poultry leg');
});
it('falls back to a plate for a dish it cannot place', () => {
  expect(folder(foodIcon({ name: '오늘의 특선' }).src)).toBe('Fork and knife with plate');
});
