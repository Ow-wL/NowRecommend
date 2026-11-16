import { afterEach, describe, expect, it, vi } from 'vitest';
import shared from '../shared/legal.json' with { type: 'json' };
import { clearBrowserData } from './storage';
import { ADULT_KEY, LEGAL_VERSION, MIN_AGE, adultConfirmed, confirmAdult, operatorKnown, privacySections, termsSections } from './legal';
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

describe('what the documents promise about this browser', () => {
  afterEach(() => vi.unstubAllGlobals());
  const area = (entries: Record<string, string>) => {
    const data = new Map(Object.entries(entries));
    return { get length() { return data.size; }, key: (n: number) => [...data.keys()][n] ?? null, getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); }, keys: () => [...data.keys()] };
  };
  it('the version and the age are the ones the server reads', () => {
    expect(LEGAL_VERSION).toBe(shared.version);
    expect(MIN_AGE).toBe(shared.minAge);
  });
  it('"clear this browser\u2019s data" removes the store, its set-aside copies and the caches, and nothing of another site', () => {
    const local = area({ 'nowrecommend-prototype-v1': '{}', 'nowrecommend-prototype-v1-before-login': '{}', 'nowrecommend-prototype-v1-before-import': '{}',
      'nowrecommend-known-items-v1': '{}', 'nowrecommend-song-check-v4': '{}', 'nowrecommend-preview-v1': '{}', 'nowrecommend-lab-v2': '{}',
      'nowrecommend-auth-v1': '{"token":"t"}', [ADULT_KEY]: LEGAL_VERSION, 'someone-elses-key': 'kept' });
    const session = area({ 'nowrecommend-session-v1': '{}', 'nowrecommend-weather-v1': '{}', 'other-tab-state': 'kept' });
    vi.stubGlobal('localStorage', local); vi.stubGlobal('sessionStorage', session);
    expect(clearBrowserData(['nowrecommend-auth-v1', ADULT_KEY])).toBe(true);
    expect(local.keys().sort()).toEqual([ADULT_KEY, 'nowrecommend-auth-v1', 'someone-elses-key'].sort());
    expect(session.keys()).toEqual(['other-tab-state']);
  });
  it('the age answer is remembered for the version it was given to', () => {
    const local = area({});
    vi.stubGlobal('localStorage', local);
    expect(adultConfirmed()).toBe(false);
    confirmAdult();
    expect(adultConfirmed()).toBe(true);
    local.setItem(ADULT_KEY, '2020-01-01');  // an answer to older documents: asked again
    expect(adultConfirmed()).toBe(false);
  });
});
