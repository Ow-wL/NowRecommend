import type { Category } from './data';
import type { Preset } from './domain';
import type { Weather } from './weather';

export type Slot = 'morning' | 'lunch' | 'afternoon' | 'evening' | 'night';
/** The hour in Korea decides the slot, whatever zone the browser is in. */
export function timeSlot(date = new Date()): Slot {
  const hour = +new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Seoul' }).format(date);
  return hour >= 5 && hour < 11 ? 'morning' : hour < 15 ? 'lunch' : hour < 18 ? 'afternoon' : hour < 22 ? 'evening' : 'night';
}
export const slotLabel: Record<Slot, string> = { morning: '아침', lunch: '점심시간', afternoon: '오후', evening: '저녁', night: '밤' };
const FOOD: Record<Slot, [string, string[]]> = {
  morning: ['가볍게 시작하는 아침', ['담백함', '따뜻함']], lunch: ['든든한 점심', ['점심', '따뜻함']], afternoon: ['가볍게 한 입', ['담백함', '상큼함']],
  evening: ['따뜻한 저녁', ['저녁', '따뜻함']], night: ['부담 없는 야식', ['담백함', '국물']],
};
const MUSIC: Record<Slot, [string, string[]]> = {
  morning: ['활기찬 아침', ['활기참', '중간 에너지']], lunch: ['집중할 때 연주곡', ['과제', '연주곡']], afternoon: ['오후의 어쿠스틱', ['어쿠스틱', '차분함']],
  evening: ['차분한 저녁', ['휴식', '차분함']], night: ['잠들기 전 잔잔하게', ['휴식', '낮은 에너지']],
};
/** The quick condition for right now. Weather, when the person asked for it, speaks before the hour; the meal of the hour stays. */
export function momentPreset(category: Category, slot: Slot, weather?: Weather | null): Preset {
  const meal = slot === 'lunch' ? ['점심'] : slot === 'evening' ? ['저녁'] : [];
  let [name, tags] = (category === 'food' ? FOOD : MUSIC)[slot];
  if (category === 'food' && weather?.rain) [name, tags] = [weather.snow ? '눈 오는 날 따뜻한 국물' : '비 오는 날 따뜻한 국물', ['국물', '따뜻함', ...meal]];
  else if (category === 'food' && weather?.cold) [name, tags] = ['추운 날 뜨끈하게', ['따뜻함', '국물', ...meal]];
  else if (category === 'food' && weather?.hot) [name, tags] = ['더운 날 시원하게', ['차가움', '상큼함', ...meal]];
  else if (category === 'music' && weather?.rain) [name, tags] = ['비 오는 날 차분한 곡', ['차분함', '낮은 에너지']];
  else if (category === 'music' && weather?.hot) [name, tags] = ['더운 날 시원한 리듬', ['활기참', '팝']];
  return { id: `moment-${category}`, category, name, conditions: { tags, excluded: [] } };
}
