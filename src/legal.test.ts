import { afterEach, describe, expect, it, vi } from 'vitest';
import shared from '../shared/legal.json' with { type: 'json' };
import { clearBrowserData } from './storage';
import { ADULT_KEY, LEGAL_VERSION, MIN_AGE, PREVIOUS_VERSIONS, adultConfirmed, confirmAdult, operatorKnown, privacySections, termsSections, versionLabel } from './legal';
import { HEALTH_CONSENT_VERSION, consentInForce } from './sensitive';
import { YOUTUBE_TERMS_VERSION } from './fullPlay';
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
    expect(LEGAL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}(\.\d+)?$/);  // the day it took effect, and its number that day if not the first
  });
  it('lists every place data leaves to, and the weather service only while that feature is on', () => {
    const policy = text(privacySections(info));
    for (const receiver of ['Google LLC', 'Google Cloud', 'Apple', 'Open-Meteo', 'Resend']) expect(policy).toContain(receiver);
    // The mail provider: who it is, where the mail is kept and for how long, and that nothing is sent unless a reset is asked for.
    const mail = privacySections(info).flatMap(section => section.blocks).flat().find(line => line.startsWith('Resend'))!;
    for (const part of ['Plus Five Five, Inc., 미국', '이메일 주소', '확인·재설정 링크', '가입할 때', '30일']) expect(mail).toContain(part);
    expect(versionLabel('2026-11-18.2')).toBe('2026-11-18 (그날 두 번째 판)');
    expect(versionLabel('2026-11-17')).toBe('2026-11-17');
    // 2026-11-18.2: sign-up confirms the address by mail; feedback is kept a year and is not tied to the account.
    for (const line of ['이메일을 확인한 일시', '이메일을 확인하지 않은 가입 신청: 7일', '의견: 받은 날부터 1년', '계정과 연결하지 않으며', '보낸 의견의 삭제']) expect(policy).toContain(line);
    expect(text(privacySections({ ...info, weather: false }))).not.toContain('Open-Meteo');
    // What a person can do themselves, and what is never collected.
    for (const line of ['계정을 삭제', '백업', '결제 정보', '쿠키']) expect(policy).toContain(line);
    // How it is destroyed, how the browser's storage is refused, and that a guest's requests leave more than an access log.
    for (const line of ['파기 방법', '데이터 저장을 막거나', '다시 로그인하면 불러옵니다', '추천 요청 내용의 통계 기록', '계정을 삭제할 때 함께 지웁니다', '운영자가 7일 안에 지웁니다']) expect(policy).toContain(line);
  });
  it('carries what the law asks a policy to state', () => {
    const sections = privacySections(info);
    const policy = text(sections);
    // Which items rest on consent and which on another ground, each ground by its number (제15조 제1항, 제22조 제3항).
    for (const line of ['동의를 받아 처리하는 정보(개인정보 보호법 제15조 제1항 제1호)', '동의 없이 처리하는 정보와 그 근거', '제4호', '제6호']) expect(policy).toContain(line);
    // Nothing is handed to third parties; what is entrusted is named, and what goes abroad says what, where, when, how long and how to refuse (제26조, 제28조의8).
    expect(policy).toContain('제3자에게 제공하거나 판매하지 않습니다');
    const abroad = sections.find(section => section.title.includes('처리 위탁과 국외 이전'))!;
    const entrusted = abroad.blocks.find(Array.isArray)!;
    expect(entrusted.map(line => line.split(' (')[0])).toEqual(['Google Cloud', 'Google LLC', 'Resend']);
    for (const line of entrusted.slice(1)) for (const part of ['이전 항목:', '이전 시기와 방법:', '보유 기간:', '문의:']) expect(line).toContain(part);
    expect(text([abroad])).toContain('제28조의8 제1항 제3호');
    expect(text([abroad])).toContain('국외 이전을 거부하는 방법과 그 효과');
    expect(entrusted[1]).toContain('55일');
    // What the browser reaches by itself is told apart from what is entrusted.
    expect(sections.find(section => section.title.includes('브라우저가 직접 연결하는'))!.blocks.find(Array.isArray)!.some(line => line.startsWith('Apple Inc.'))).toBe(true);
    // Rights: how, and by when; who to complain to; no children; the history of the policy itself.
    for (const line of ['10일 안에', '동의 철회', '위임장', '경찰청', '만 14세 미만 아동의 개인정보는 처리하지 않습니다', '2026-11-17: 처음 시행.', '민감정보(건강)', '제23조 제1항 제1호', '설정 > 데이터 관리에서 언제든 철회', '운영자 한 사람만 접근', '요청을 받은 날부터 10일 안에', '취향 유형 검사의 결과', '저장해 둔 조건 묶음']) expect(policy).toContain(line);
  });
  it('keeps the terms within what a standard-terms contract may say', () => {
    const terms = text(termsSections(info));
    // No sentence that limits liability to intent and gross negligence, a reason and a notice for changes, and no court of the operator's choosing (약관법 제7조, 제10조, 제14조).
    expect(terms).not.toContain('고의 또는 중대한 과실');
    for (const line of ['운영자에게 책임이 있는 사유로', '30일 전부터', '시행일 7일 전부터', '민사소송법에 따라', '동의하지 않으면', '이유를 미리 알리며', 'Google Gemini']) expect(terms).toContain(line);
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

// The kept versions as files (public/legal/<version>/), read by the bundler: no file, no entry.
const kept = import.meta.glob<string>('../public/legal/*/*.html', { query: '?raw', import: 'default', eager: true });

describe('versions of the documents', () => {
  it('keeps every earlier version as it was shown, older than the one in force', () => {
    expect(PREVIOUS_VERSIONS.length).toBeGreaterThan(0);
    for (const version of PREVIOUS_VERSIONS) {
      expect(version < LEGAL_VERSION).toBe(true);
      for (const kind of ['terms', 'privacy']) {
        const page = kept[`../public/legal/${version}/${kind}.html`];
        expect(page, `public/legal/${version}/${kind}.html`).toBeDefined();
        expect(page).toContain(`시행일 ${version}`);
        expect(page).toContain('지난 판');
      }
    }
    expect(text(privacySections(info))).toContain(`${versionLabel(LEGAL_VERSION)}: 지금의 판`);
  });
  it('does not ask the health consent or the YouTube agreement again for a version that leaves them alone', () => {
    expect(HEALTH_CONSENT_VERSION <= LEGAL_VERSION && YOUTUBE_TERMS_VERSION <= LEGAL_VERSION).toBe(true);
    expect(consentInForce({ version: HEALTH_CONSENT_VERSION, at: '2026-11-17T12:00:00.000Z' })).toBe(true);
  });
});

describe('what the terms must make plain', () => {
  it('marks the clauses that matter most, and only whole sentences', () => {
    const marked = termsSections(info).flatMap(section => section.blocks.flat()).flatMap(block => [...block.matchAll(/\*\*(.+?)\*\*/g)].map(m => m[1]));
    for (const clause of ['외부 AI 서비스(Google Gemini)로 보내 만듭니다', '알레르기 안전을 보장하지 않습니다', '이용을 제한하거나 계정을 삭제할 수 있습니다',
      '30일 전부터 서비스 화면에 알립니다', '정확하다거나 특정한 목적에 맞는다고 보증하지 않습니다', '저장소를 지우면 함께 사라집니다'])
      expect(marked.some(text => text.includes(clause)), clause).toBe(true);
    for (const text of marked) expect(text).toMatch(/[.,]$/);
    expect(text(privacySections(info))).not.toContain('**');
  });
});
