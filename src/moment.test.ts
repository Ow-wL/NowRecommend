import { expect, it } from 'vitest';
import { options } from './data';
import { momentPreset, timeSlot } from './moment';
import { weatherFrom } from './weather';
it('reads the slot from the Korean hour', () => {
  expect(timeSlot(new Date('2026-11-08T21:30:00Z'))).toBe('morning');   // 06:30 KST
  expect(timeSlot(new Date('2026-11-09T03:00:00Z'))).toBe('lunch');     // 12:00
  expect(timeSlot(new Date('2026-11-09T07:00:00Z'))).toBe('afternoon'); // 16:00
  expect(timeSlot(new Date('2026-11-09T10:00:00Z'))).toBe('evening');   // 19:00
  expect(timeSlot(new Date('2026-11-09T13:00:00Z'))).toBe('night');     // 22:00
});
it('builds a valid quick condition for every slot, and lets the weather speak first', () => {
  for (const category of ['food', 'music'] as const) for (const slot of ['morning', 'lunch', 'afternoon', 'evening', 'night'] as const) {
    const preset = momentPreset(category, slot);
    expect(preset.conditions.tags.every(t => options[category].includes(t))).toBe(true);
    expect(preset.name.length).toBeLessThanOrEqual(30);
  }
  const rain = weatherFrom({ temperature_2m: 12, precipitation: 0.4, weather_code: 61 });
  expect(rain.rain).toBe(true);
  expect(momentPreset('food', 'evening', rain).conditions.tags).toEqual(['국물', '따뜻함', '저녁']);
  expect(momentPreset('music', 'lunch', rain).name).toBe('비 오는 날 차분한 곡');
  const hot = weatherFrom({ temperature_2m: 31, precipitation: 0, weather_code: 0 });
  expect(hot).toMatchObject({ hot: true, rain: false, temperature: 31 });
  expect(momentPreset('food', 'lunch', hot).conditions.tags).toContain('차가움');
  expect(momentPreset('music', 'night', hot).conditions.tags.every(t => options.music.includes(t))).toBe(true);
});
