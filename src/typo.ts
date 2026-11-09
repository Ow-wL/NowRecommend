import vocab from '../shared/vocab.json';
import type { Category } from './data';

// A slip of the thumb ("따뚫한" for "따뜻한") keeps a condition from being read and stays in the request's name. This offers
// the known word the slip most likely meant, and only that: one syllable off, same first consonant or one jamo apart,
// and anything after the word must be a particle. The person applies it with a tap; nothing is changed on its own.
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ', JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
export function jamo(syllable: string): string[] {
  const code = syllable.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return [syllable];
  return [CHO[Math.floor(code / 588)], JUNG[Math.floor((code % 588) / 28)], JONG[code % 28]].filter(Boolean);
}
function distance(a: string[], b: string[]): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return rows[a.length][b.length];
}
/** One syllable off, and plausibly a slip: the same first consonant, or a single jamo apart. */
export function nearSyllable(a: string, b: string): boolean {
  if (a === b) return false;
  const ja = jamo(a), jb = jamo(b);
  return ja[0] === jb[0] || distance(ja, jb) <= 1;
}
const PARTICLES = ['', '이', '가', '을', '를', '은', '는', '에', '에서', '으로', '로', '도', '만', '이랑', '랑', '과', '와', '의', '하고', '까지', '부터', '이나', '나', '요'];
/** The words the rules read, in the shapes they appear in a sentence: "따뜻함" also as "따뜻한" and "따뜻하게". */
export function knownForms(category: Category): string[] {
  const v = vocab as { food: { conditionTags: string[]; extraTags: string[]; exclusions: string[]; exclusionAliases: Record<string, string[]> }; music: { conditionTags: string[]; exclusions: string[] } };
  const base = category === 'food' ? [...v.food.conditionTags, ...v.food.extraTags, ...v.food.exclusions, ...Object.keys(v.food.exclusionAliases)] : [...v.music.conditionTags, ...v.music.exclusions];
  const forms = new Set<string>();
  for (const word of base) {
    forms.add(word);
    if (word.endsWith('함')) { const stem = word.slice(0, -1); forms.add(`${stem}한`); forms.add(`${stem}하게`); }
    if (word.endsWith('참')) forms.add(`${word.slice(0, -1)}찬`);
  }
  return [...forms].filter(f => f.length >= 2 && /^[가-힣 ]+$/.test(f) && !f.includes(' '));
}
export type Suggestion = { from: string; to: string };
export function typoSuggestions(raw: string, category: Category, forms = knownForms(category)): Suggestion[] {
  const out: Suggestion[] = [], seen = new Set<string>();
  const longestFirst = [...forms].sort((a, b) => b.length - a.length);
  for (const token of raw.split(/[^가-힣]+/)) {
    if (token.length < 2 || seen.has(token) || forms.some(f => token.startsWith(f))) continue;
    for (const form of longestFirst) {
      if (form.length > token.length) continue;
      const prefix = token.slice(0, form.length), rest = token.slice(form.length);
      if (!PARTICLES.includes(rest)) continue;
      const off = [...prefix].map((ch, n) => ch !== form[n] ? n : -1).filter(n => n >= 0);
      if (off.length === 1 && nearSyllable(prefix[off[0]], form[off[0]])) { out.push({ from: token, to: form + rest }); seen.add(token); break; }
    }
  }
  return out;
}
/** The sentence with one slip replaced, word by word, so the rest is left exactly as typed. */
export const applySuggestion = (raw: string, s: Suggestion) => raw.split(/(?<=[^가-힣])|(?=[^가-힣])/).map(part => part === s.from ? s.to : part).join('');
