import { describe, expect, it } from 'vitest';
import { LEGAL_VERSION, MIN_AGE, operatorKnown, privacySections, termsSections } from './legal';
import { previewsOnOf, weatherModeOf } from './features';
import { weatherUrl } from './weather';

const info = { operator: '홍길동', contact: 'help@example.com', weather: true, previews: true };
const text = (sections: { title: string; blocks: (string | string[])[] }[]) => sections.flatMap(s => [s.title, ...s.blocks.flat()]).join('\n');

describe('terms and privacy policy', () => {
  it('names who runs the service and where to write, and says so when that is not set', () => {
    expect(text(termsSections(info))).toContain('홍길동');
    expect(text(privacySections(info))).toContain('help@example.com');
    expect(text(privacySections({ ...info, operator: '', contact: '' }))).toContain('(문의 주소 준비 중)');
    expect(operatorKnown('홍길동', 'help@example.com')).toBe(true);
    expect(operatorKnown('', 'help@example.com')).toBe(false);
    expect(operatorKnown('홍길동', 'not-an-address')).toBe(false);
  });
  it('states the age the AI provider requires, in both documents and as one number', () => {
    expect(MIN_AGE).toBe(18);
    expect(text(termsSections(info))).toContain('만 18세 이상');
    expect(text(privacySections(info))).toContain('만 18세');
    expect(LEGAL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('lists every place data leaves to, and the weather service only while that feature is on', () => {
    const policy = text(privacySections(info));
    for (const receiver of ['Google LLC', 'Google Cloud', 'Apple', 'Open-Meteo', '메일 발송']) expect(policy).toContain(receiver);
    expect(text(privacySections({ ...info, weather: false }))).not.toContain('Open-Meteo');
    // What a person can do themselves, and what is never collected.
    for (const line of ['계정을 삭제', '백업', '결제 정보', '쿠키']) expect(policy).toContain(line);
  });
  it('does not promise allergy safety', () => {
    expect(text(termsSections(info))).toContain('알레르기 안전을 보장하지 않습니다');
  });
});

describe('parts that depend on other companies\u2019 terms', () => {
  it('weather: off by a switch, paid with a key, free otherwise', () => {
    expect(weatherModeOf({})).toBe('free');
    expect(weatherModeOf({ VITE_WEATHER: ' OFF ' })).toBe('off');
    expect(weatherModeOf({ VITE_OPEN_METEO_KEY: 'k' })).toBe('paid');
    expect(weatherModeOf({ VITE_WEATHER: 'off', VITE_OPEN_METEO_KEY: 'k' })).toBe('off');
    const query = new URLSearchParams({ latitude: '37.57', longitude: '126.98' });
    expect(weatherUrl(query, 'free', '')).toBe('https://api.open-meteo.com/v1/forecast?latitude=37.57&longitude=126.98');
    expect(weatherUrl(query, 'paid', 'secret')).toBe('https://customer-api.open-meteo.com/v1/forecast?latitude=37.57&longitude=126.98&apikey=secret');
    expect(query.has('apikey')).toBe(false);  // the caller's query is not changed
  });
  it('previews: on unless switched off', () => {
    expect(previewsOnOf({})).toBe(true);
    expect(previewsOnOf({ VITE_APPLE_PREVIEWS: 'off' })).toBe(false);
  });
});
