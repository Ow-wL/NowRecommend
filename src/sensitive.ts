// Health in what a person types (2026-11-17). Words about a person's health are "sensitive information" in the privacy
// law (개인정보 보호법 제23조): they are handled only with a consent of their own, asked apart from every other one.
// The service does not ask about health, but its text fields take any words, and "땅콩 알레르기" is a sentence it is
// built to understand. So before such words are stored or leave the browser the person is asked once (HealthConsent),
// and until they agree nothing with those words goes to the server:
//
// - the screens ask before they save or send (App.tsx `withHealth`);
// - the two requests that carry typed words refuse or drop them here, whatever screen they came from (`sendable`,
//   `sendableNotes`): a sentence kept from before this existed, one restored from a backup or from another device.
//
// The list is words that say something about a body or an illness, not about taste: "매운 거 못 먹어요" is a
// preference, "위염이라 매운 거 못 먹어요" is health. A word too many costs one question; a word too few sends what
// should have been asked about.
import { LEGAL_VERSION } from './legal';

/** Where this browser remembers the consent: which policy it was given under, and when. */
export const HEALTH_KEY = 'nowrecommend-health-consent-v1';
export type HealthConsent = { version: string; at: string };

const HEALTH = new RegExp([
  '알레르기|알러지|불내증|아토피|천식|두드러기',
  '당뇨|혈당|혈압|고지혈|콜레스테롤|통풍|빈혈',
  '임신|임산부|수유\\s*중',
  '항암|암\\s*환자|투병|투석|수술|입원|퇴원|복용|처방|약\\s*(?:을\\s*)?먹|환자|질환|질병|지병|진단',
  '위염|식도염|장염|과민성|크론|셀리악',
  '우울증|공황|불면증|거식증|폭식증|섭식\\s*장애',
].join('|'), 'g');

/** The health words in these texts, each once, in the order they appear. */
export function healthTerms(...texts: (string | null | undefined)[]): string[] {
  const found: string[] = [];
  for (const text of texts) for (const match of (text || '').matchAll(HEALTH)) { const word = match[0].replace(/\s+/g, ' '); if (!found.includes(word)) found.push(word); }
  return found;
}

export function healthConsent(): HealthConsent | null {
  try {
    const saved = JSON.parse(localStorage.getItem(HEALTH_KEY) || 'null') as Partial<HealthConsent> | null;
    return saved && typeof saved.version === 'string' && typeof saved.at === 'string' ? { version: saved.version, at: saved.at } : null;
  } catch { return null; }
}
/** Given, and under the policy in force: a new version of the policy asks again. */
export function healthConsented(): boolean { return healthConsent()?.version === LEGAL_VERSION; }
export function giveHealthConsent(now = new Date()): void { try { localStorage.setItem(HEALTH_KEY, JSON.stringify({ version: LEGAL_VERSION, at: now.toISOString() })); } catch { /* asked again next time */ } }
export function withdrawHealthConsent(): void { try { localStorage.removeItem(HEALTH_KEY); } catch { /* nothing was kept */ } }

/** A typed sentence was about to be sent with health words in it and no consent. The screens ask first, so reaching this
 * means a path that did not: it is stopped, not sent. */
export class HealthConsentNeeded extends Error {
  constructor(public terms: string[]) { super('health consent needed'); this.name = 'HealthConsentNeeded'; }
}
/** The sentence as it may leave the browser: itself, or an error while it has health words and there is no consent. */
export function sendable(text: string): string {
  const terms = healthConsented() ? [] : healthTerms(text);
  if (terms.length) throw new HealthConsentNeeded(terms);
  return text;
}
/** The notes that may leave the browser: without consent, the ones with health words stay behind. */
export function sendableNotes(notes: string[]): string[] {
  return healthConsented() ? notes : notes.filter(note => !healthTerms(note).length);
}
