// Health in what a person types (2026-11-17). Words about a person's health are "sensitive information" in the privacy
// law (개인정보 보호법 제23조): they are handled only with a consent of their own, asked apart from every other one.
// The service does not ask about health, but its text fields take any words, and "땅콩 알레르기" is a sentence it is
// built to understand.
//
// The rule: the store (what is kept, and what an account syncs) holds such words only together with the consent, and
// nothing with such words is sent to the server without it.
//
// - The consent is part of the store (`Store.health`: the policy version and the time), so it travels with the data it
//   covers: to the account, to another device, into a backup. Saying no, or withdrawing, is kept the same way with
//   its own time, and between two devices the later of the two holds (src/sync.ts).
// - The screens ask before they save or send (App.tsx `withHealth`).
// - A store that has such words and no consent (kept from before this existed, restored from a backup, written by a
//   path that did not ask) is put to the person as it is found: agree, or have those texts removed
//   (`withoutHealthTexts`). Until they answer, account sync is paused.
// - The two requests that carry typed words refuse or drop them here, whatever screen they came from (`sendable`,
//   `sendableNotes`).
//
// The list is words that say something about a body or an illness, not about taste: "매운 거 못 먹어요" is a
// preference, "위염이라 매운 거 못 먹어요" is health. It is a list, so it misses what it does not name (the policy says
// so); a word too many costs one question, once.
import { emptyStore, type Profile, type Store } from './domain';
import { LEGAL_VERSION } from './legal';

/** `withdrawn`: the answer was no, or the consent was taken back, at `at`. */
export type HealthConsent = { version: string; at: string; withdrawn?: true };

const HEALTH = new RegExp([
  '알레르기|알러지|불내증|아토피|천식|두드러기|비염',
  '당뇨|혈당|혈압|고지혈|콜레스테롤|통풍|빈혈',
  '임신|임산부|입덧|수유\\s*중|생리통|생리\\s*중',
  '항암|암\\s*환자|투병|투석|수술|입원|퇴원|복용|처방\\s*받|처방\\s*약|처방전|약\\s*(?:을\\s*)?먹|환자|질환|질병|지병|진단\\s*(?:을\\s*)?받|진단서|확진',
  '위염|식도염|역류성|장염|과민성|크론|셀리악|배탈|설사|변비|체했|체해서',
  '감기|몸살|독감|두통|치통|아파서|아픈데|아파요|속이\\s*안\\s*좋|몸이\\s*안\\s*좋',
  '우울증|공황|불면증|거식증|폭식증|섭식\\s*장애',
].join('|'), 'g');

/** The health words in these texts, each once, in the order they appear. */
export function healthTerms(...texts: (string | null | undefined)[]): string[] {
  const found: string[] = [];
  for (const text of texts) for (const match of (text || '').matchAll(HEALTH)) { const word = match[0].replace(/\s+/g, ' '); if (!found.includes(word)) found.push(word); }
  return found;
}

// ---- the consent ----

export const validHealthConsent = (v: unknown): v is HealthConsent => !!v && typeof (v as HealthConsent).version === 'string' && typeof (v as HealthConsent).at === 'string' && Number.isFinite(Date.parse((v as HealthConsent).at))
  && ((v as HealthConsent).withdrawn === undefined || (v as HealthConsent).withdrawn === true);
/** Given, not taken back, and under the policy in force: a new version of the policy asks again. */
export const consentInForce = (consent: HealthConsent | null | undefined): boolean => validHealthConsent(consent) && !consent.withdrawn && consent.version === LEGAL_VERSION;
/** Of two devices' records, the one made later. */
export function laterHealth(a: HealthConsent | undefined, b: HealthConsent | undefined): HealthConsent | undefined {
  if (!validHealthConsent(a)) return validHealthConsent(b) ? b : undefined;
  if (!validHealthConsent(b)) return a;
  const ta = Date.parse(a.at), tb = Date.parse(b.at);
  return tb > ta || tb === ta && !!b.withdrawn ? b : a;  // at the same instant, the withdrawal
}
/** The consent in force for the store on screen. App.tsx keeps it up to date (`noteHealthConsent(store.health)`); the
 * requests below read it, so they need no store handed to them. */
let current: HealthConsent | null = null;
export function noteHealthConsent(consent: HealthConsent | null | undefined): void { current = validHealthConsent(consent) ? consent : null; }
export function healthConsented(): boolean { return consentInForce(current); }
export const newHealthConsent = (now = new Date()): HealthConsent => ({ version: LEGAL_VERSION, at: now.toISOString() });
export const withdrawnHealthConsent = (now = new Date()): HealthConsent => ({ version: LEGAL_VERSION, at: now.toISOString(), withdrawn: true });

// ---- what a store holds ----

/** History entries made without a sentence carry this as theirs (src/history.ts); a removed sentence becomes one. */
const NO_SENTENCE = '직접 선택한 조건';
const REMOVED_PRESET = '내 조건';
const about = (text: string | undefined) => healthTerms(text).length > 0;

const profileTexts = (profile: Profile): (string | undefined)[] => [...Object.values(profile.reasons || {}), ...(profile.custom || []).flatMap(c => [c.name, c.reason])];
/** Every text a person typed that the store keeps. */
export function storeTexts(store: Store): (string | undefined)[] {
  return [store.name, ...Object.values(store.profiles).flatMap(profileTexts), ...store.history.flatMap(h => [h.raw, h.review?.note, ...h.rounds.map(r => r.raw)]), ...(store.presets || []).map(p => p.name)];
}
export const storeHealthTerms = (store: Store): string[] => healthTerms(...storeTexts(store));
/** The store holds such words and no consent under the policy in force: it is not uploaded, and the person is asked. */
export const owesHealthAnswer = (store: Store): boolean => !consentInForce(store.health) && storeHealthTerms(store).length > 0;

/** The profile without what was written about health: such reasons, and typed-in favourites named that way. */
export function withoutHealthProfile(profile: Profile): Profile {
  const reasons = Object.fromEntries(Object.entries(profile.reasons || {}).filter(([, reason]) => !about(reason)));
  const custom = (profile.custom || []).filter(c => !about(c.name)).map(c => about(c.reason) ? (({ reason: _, ...rest }) => rest)(c) : c);
  const { reasons: _r, custom: _c, ...rest } = profile;
  return { ...rest, ...(Object.keys(reasons).length ? { reasons } : {}), ...(custom.length ? { custom } : {}) };
}
/** The store without the texts that have health words in them. What was recommended, chosen and rated stays; a sentence
 * becomes "no sentence", a note is emptied, a preset keeps its conditions under a plain name. */
export function withoutHealthTexts(store: Store): Store {
  return { ...store, name: about(store.name) ? emptyStore().name : store.name,
    profiles: Object.fromEntries(Object.entries(store.profiles).map(([category, profile]) => [category, withoutHealthProfile(profile)])) as Store['profiles'],
    history: store.history.map(h => ({ ...h, raw: about(h.raw) ? NO_SENTENCE : h.raw, rounds: h.rounds.map(r => about(r.raw) ? { ...r, raw: NO_SENTENCE } : r),
      ...(h.review && about(h.review.note) ? { review: { ...h.review, note: '' } } : {}) })),
    ...(store.presets ? { presets: store.presets.map(p => about(p.name) ? { ...p, name: REMOVED_PRESET } : p) } : {}),
  };
}

// ---- what may leave the browser ----

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
  return healthConsented() ? notes : notes.filter(note => !about(note));
}
