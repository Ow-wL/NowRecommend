import { dietExclusions, exclusionAliases, exclusionGroups, exclusionHeadNouns, exclusionShortWords, exclusionStopWords, exclusions, excludableIngredients, tagLabels, unsupportedExclusions, type Category, type Item } from './data';
import { getCatalog } from './catalog';

const catalogItems = () => getCatalog().items;
export type Profile = { selected: string[]; tags: string[]; disliked: string[] };
// Price and budget were removed on 2026-10-27; stored conditions may still carry `maxPrice`, which cleanConditions drops.
export type Conditions = { tags: string[]; excluded: string[] };
export type ConditionEditor = { parsedRaw: string; automatic: Conditions; manual: Conditions; removedTags: string[]; removedExcluded: string[];
  /** How the server read `raw` ('local': server unreachable, browser rules kept). Applies only while raw matches. */
  ai?: { raw: string; source: 'rule' | 'rule+ai' | 'local'; unparsed: string[] } };
export type Session = { category: Category; raw: string; conditions: Conditions; excludedIds: string[]; revision: number; editor?: ConditionEditor; seenIds?: string[]; currentIds?: string[]; batchNewCount?: number;
  /** Cards of this round that had been seen before the round began (a reroll that ran out of unseen ones). */
  repeatIds?: string[]; id?: string; roundId?: string; snapshot?: Recommendation[]; candidateScope?: 'favorites'; candidateIds?: string[]; pinnedIds?: string[]; compareIds?:string[]; source?: 'server' | 'local';
  /** How the server produced the current cards (only with source 'server'): AI used/failed/off, sentence meaning used. */
  quality?: { ai: 'used' | 'failed' | 'off'; context: boolean } };
/** `contrast` compares the card with the others shown with it ("추천 중 유일하게 …"). It is recomputed whenever the shown set
 * changes (withContrast); taste and context reasons only describe the card itself. */
export type Recommendation = { item: Item; tasteReason: string; contextReason: string; contrast?: string };
export type Feedback = { itemId: string; scope: 'session' | 'long'; action: 'exclude' | 'restore'; date: string };
export type Round = { id: string; date: string; raw: string; conditions: Conditions; results: Recommendation[]; feedback: Feedback[]; excludedIds: string[]; catalogVersion?: string; candidateScope?: 'favorites'; candidateIds?: string[] };
export type Selection = { result: Recommendation; date: string; roundId: string };
export type Review = { rating?:'good'|'neutral'|'poor';note:string;date:string;itemId:string;roundId:string };
export type HistoryEntry = { id: string; date: string; category: Category; raw: string; conditions: Conditions; resultIds: string[]; rounds: Round[]; selected?: Selection; review?:Review;legacy?: boolean; trimmedRounds?: number };
export type Preset = { id: string; category: Category; name: string; conditions: Conditions };
export type Appearance={mode:'dark'|'light'|'system';accent?:string};
export type Store = { version: 2; name: string; profiles: Record<Category, Profile>; favorites: string[]; history: HistoryEntry[]; presets?: Preset[];appearance?:Appearance };
export const emptyProfile = (): Profile => ({ selected: [], tags: [], disliked: [] });
export const emptyStore = (): Store => ({ version: 2, name: '취향 탐험가', profiles: { food: emptyProfile(), music: emptyProfile() }, favorites: [], history: [] });
export const emptyConditions = (): Conditions => ({ tags: [], excluded: [] });
/** Conditions from storage, backups, history and older servers: only tags and exclusions survive (no budget). */
export const cleanConditions = (v: { tags: string[]; excluded: string[] }): Conditions => ({ tags: [...v.tags], excluded: [...v.excluded] });
export function updateFeedback(profile: Profile, session: Session, id: string, scope: 'session' | 'long') {
  return { profile: scope === 'long' ? { ...profile, disliked: [...new Set([...profile.disliked, id])] } : profile,
    session: scope === 'session' ? { ...session, excludedIds: [...new Set([...session.excludedIds, id])] } : session };
}
// Genres: a whole word, so 기록·연락·락스·록키·팝콘 and "화면 락 걸고" are not music. Mirrored in server/app/parsing/rules.py.
const GENRE_FOLLOW = '음악|노래|밴드|곡|송|풍|스타일|느낌|장르|계열|위주|으로|이나|이랑|이|은|을|과|도|만|의|에|처럼|같은|하고|랑|가|는|를|로|와|나';
const genreWord = (words: string) => `(?<![가-힣A-Za-z])(?:${words})(?=$|[^가-힣A-Za-z]|${GENRE_FOLLOW})`;
const latinWord = (words: string) => `(?<![A-Za-z])(?:${words})(?![A-Za-z])`;
const ROCK = new RegExp(`${genreWord('록|락(?!\\s*(?:을|이)?\\s*(?:걸|풀|해제))')}|로큰롤|락앤롤|록앤롤|록큰롤|(?:하드|모던|펑크|얼터너티브|브릿|인디)\\s?록|${latinWord('rock')}`, 'i');
const POP = new RegExp(`${genreWord('팝')}|(?:케이|시티|제이)\\s?팝|${latinWord('k-?pop|j-?pop|pop')}`, 'i');
const BALLAD = new RegExp(`발라드|${latinWord('ballads?')}`, 'i');
/** Genres the catalog has no tag for: named before recommending instead of disappearing ("힙합 노래"). */
const UNSUPPORTED_GENRES = new RegExp(`(?:${genreWord('힙합|랩|클래식|트로트|뽕짝|일렉트로닉|일렉|알앤비|인디|메탈|펑크|레게|컨트리|블루스|디스코|댄스|뉴에이지|로파이|동요|국악|오페라|EDM|R&B|CCM')}|헤비\\s?메탈|전자\\s?음악|${latinWord('hip-?hop|edm|r&b|lo-?fi|classical|metal|reggae|disco')})(?!\\s?[록락])`, 'gi');
const TAG_RULES: Record<Category, [RegExp, string][]> = {
  food: [[/혼자|혼밥/, '혼자'], [/함께|친구|둘이/, '함께'], [/저녁/, '저녁'], [/점심/, '점심'], [/담백|순한|부담.?없/, '담백함'], [/매콤|매운|칼칼|얼큰/, '매콤함'], [/고소/, '고소함'], [/따뜻|따끈/, '따뜻함'], [/시원|차가운/, '차가움'], [/국물/, '국물'], [/채소|야채/, '채소']],
  music: [[/과제|공부|집중|작업/, '과제'], [/휴식|쉬|잠|편안/, '휴식'], [/산책|걷/, '산책'], [/운동|달리|러닝/, '운동'], [/잔잔|차분|조용/, '차분함'], [/활기|신나|밝은/, '활기참'], [/적당히|적당한/, '중간 에너지'], [/연주곡|보컬.?없|가사.?없/, '연주곡'], [/재즈/, '재즈'], [/피아노/, '피아노'], [/어쿠스틱/, '어쿠스틱'], [ROCK, '록'], [POP, '팝'], [BALLAD, '발라드']],
};
// The prototype only maps known phrases. It never calls an AI service.
export function parseConditions(text: string, category: Category): Conditions {
  const condition = emptyConditions();
  // What a sentence asks to leave out is never read as wanted ("국물 있는 건 빼줘", "채소 빼고"), even when it cannot be excluded.
  const negations = readNegations(text, category);
  for (const [pattern, value] of TAG_RULES[category]) if (pattern.test(negations.masked) && !negations.notWanted.has(value)) condition.tags.push(value);
  const excluded = new Set([...listedExclusions(text, category).found, ...negations.excluded]);
  // "비건이라서 …": a diet names its groups without any trigger word; the live AI check (2026-10-27) found it applied only
  // when the model was reachable.
  for (const [word, values] of Object.entries(dietExclusions[category])) if (new RegExp(`(?<![가-힣])${word}`).test(text)) values.forEach(v => excluded.add(v));
  if (category === 'food') {
    if (new RegExp(`안\\s*매운|맵지\\s*않|매운.{0,5}(${EXCLUDE})`).test(text)) excluded.add('매콤함');
  } else if (/보컬.?없|가사.?없|보컬.{0,5}(제외|싫)/.test(text)) excluded.add('보컬');
  // Like "매운 건 빼고": an excluded value is never also a wanted tag ("피아노 말고").
  condition.excluded = exclusions[category].filter(v => excluded.has(v));
  condition.tags = condition.tags.filter(t => !excluded.has(t));
  return condition;
}
// "프리" is for "글루텐 프리"; "프리미엄" must not exclude the beef in "소고기 프리미엄 스테이크".
const EXCLUDE = /제외|빼|피하|싫|없[이는게음고]|말고|못\s*먹|안\s*먹|알레르기|알러지|불내증|금지|안\s*들어|안\s*돼|프리(?!미엄)/.source;
// Items joined by spaces, commas or particles: "고기 생선 달걀 다 빼줘", "소고기와 돼지고기는 제외".
const JOINER = /[\s,]*(?:이랑|하고|이나|과|와|랑|및|나|도)?[\s,]*/.source;
/** Every listed word before an exclusion trigger, mapped to vocabulary values via exclusionAliases (shared/vocab.json).
 * Words the catalog cannot check at all ("새우") come back in `unsupported` instead of being mapped to something narrower. */
function listedExclusions(text: string, category: Category): { found: Set<string>; unsupported: string[] } {
  const words: Record<string, string[]> = { ...Object.fromEntries(exclusions[category].map(v => [v, [v]])), ...exclusionAliases[category] };
  const term = [...Object.keys(words), ...unsupportedExclusions[category]].sort((a, b) => b.length - a.length).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const found = new Set<string>(), unsupported: string[] = [];
  for (const match of text.matchAll(new RegExp(`(?<![가-힣])((?:${term})(?:${JOINER}(?:${term}))*).{0,6}?(?:${EXCLUDE})`, 'g')))
    for (const [word] of match[1].matchAll(new RegExp(term, 'g'))) { if (words[word]) words[word].forEach(v => found.add(v)); else unsupported.push(word); }
  return { found, unsupported: [...new Set(unsupported)] };
}

// Particles a noun may carry before the trigger ("참깨는 빼줘"), and the ones that join a list ("오이랑 고수 빼줘").
const PARTICLES = ['이랑', '하고', '이나', '은', '는', '이', '가', '을', '를', '도', '만', '랑', '와', '과', '나'];
const LIST_JOINER = /(?:이랑|하고|랑|와|과|및)$/;
// Verb and adjective forms ("들어가면 안 돼", "먹을", "매운") are not things to exclude; 라면·냉면 are nouns.
const NOT_A_NOUN = /(?:으면|하면|되면|가면|오면|이면|다면|서|게|니|며|던|한|운|할|된|을|는|은|싶은|있는|하는)$/;
// "국물 있는 건", "고기 들어간 거", "라면 같은 거": the noun before these is what the negated phrase is about.
const HOLDS = /(?:있는|들어간|들어있는|많은|같은|든|섞인|올라간|넣은|뿌린)$/;
const letters = (token: string) => token.replace(/[^가-힣A-Za-z]/g, '');
const noun = (token: string): string | null => {
  let word = letters(token);
  // The first particle that leaves a word of two or more letters, or a listed short word: "오이랑" → 오이 ("오이" stays),
  // "깨는" → 깨, "파는" → 파.
  const particle = PARTICLES.find(p => word.endsWith(p) && (word.length - p.length >= 2 || word.slice(0, -p.length) in exclusionShortWords));
  if (particle) word = word.slice(0, -particle.length);
  if (word in exclusionShortWords) return word;
  return word.length < 2 || exclusionStopWords.includes(word) || NOT_A_NOUN.test(word) ? null : word;
};
// "건", "거는", "걸로", "음식은": the head noun of "고소한 건 빼줘".
const isHead = (token: string) => { const w = letters(token); return exclusionHeadNouns.some(h => w === h || w.startsWith(h) && [...PARTICLES, '로', '으로'].includes(w.slice(h.length))); };
// Adnominal forms end in ㄴ, ㄹ or 는: "고소한", "매운", "먹을", "있는".
const isModifier = (token: string) => {
  const w = letters(token), code = w.charCodeAt(w.length - 1) - 0xac00;
  return !!w && !exclusionStopWords.includes(w) && (w.endsWith('는') || code >= 0 && code < 11172 && [4, 8].includes(code % 28));
};
type Negated = { start: number; end: number; phrase: string; nouns: string[]; head: boolean };
/** The phrase each exclusion trigger negates. Either a head-noun phrase ("국물 있는 건 빼줘", "고소한 거 말고": the whole
 * phrase is negated) or a list of nouns ("오이랑 고수 빼줘"; across commas only when every part is one word:
 * "점심, 고수, 참깨 빼줘" → 고수, 참깨 but not 점심). Mirrored in server/app/parsing/rules.py. */
function negatedPhrases(text: string): Negated[] {
  const found: Negated[] = [];
  for (const match of text.matchAll(new RegExp(EXCLUDE, 'g'))) {
    const before = text.slice(0, match.index);
    const clauseStart = Math.max(...['.', '!', '?', ';', '·', '\n'].map(c => before.lastIndexOf(c))) + 1;
    const tokens: { text: string; start: number; end: number; segment: number }[] = [];
    let segment = 0;
    for (const t of before.slice(clauseStart).matchAll(/[^\s,]+|,/g)) {
      if (t[0] === ',') segment++;
      else tokens.push({ text: t[0], start: clauseStart + t.index!, end: clauseStart + t.index! + t[0].length, segment });
    }
    const taken: typeof tokens = [], nouns: string[] = [];
    let i = tokens.length - 1;
    const takeNouns = () => {
      for (let first = true; i >= 0; first = false) {
        const token = tokens[i], next = taken[0];
        if (!first && next && (token.segment === next.segment ? !LIST_JOINER.test(letters(token.text))
          : token.segment !== next.segment - 1 || tokens.filter(t => t.segment === token.segment).length !== 1)) break;
        const word = noun(token.text);
        if (!word) break;
        nouns.unshift(word); taken.unshift(token); i--;
      }
    };
    const head = i >= 0 && isHead(tokens[i].text);
    if (head) {
      taken.unshift(tokens[i--]);
      while (i >= 0 && tokens[i].segment === taken[0].segment && isModifier(tokens[i].text)) {
        const holds = HOLDS.test(letters(tokens[i].text));
        taken.unshift(tokens[i--]);
        if (holds) { takeNouns(); break; }
      }
    } else takeNouns();
    if (taken.length) found.push({ start: taken[0].start, end: taken[taken.length - 1].end, phrase: text.slice(taken[0].start, taken[taken.length - 1].end), nouns, head });
  }
  return found;
}
/** What the negated phrases ask to leave out: exclusions to apply, ones that cannot be applied (reported, never turned
 * into a wanted tag), the text with head-noun phrases blanked for the wanted-tag rules, and tags never to want. */
function readNegations(text: string, category: Category) {
  const words: Record<string, string[]> = { ...Object.fromEntries(exclusions[category].map(v => [v, [v]])), ...exclusionAliases[category] };
  const excluded = new Set<string>(), unsupported: Unsupported[] = [], notWanted = new Set<string>();
  let masked = text;
  const leaveOut = (tag: string) => { notWanted.add(tag); if (exclusions[category].includes(tag)) excluded.add(tag); else unsupported.push({ kind: 'trait', text: `${tag} 제외` }); };
  for (const negated of negatedPhrases(text)) {
    if (negated.head) {
      masked = masked.slice(0, negated.start) + ' '.repeat(negated.end - negated.start) + masked.slice(negated.end);
      const tags = TAG_RULES[category].filter(([pattern]) => pattern.test(negated.phrase));
      tags.forEach(([, tag]) => leaveOut(tag));
      // "기름진 거 빼줘": nothing the app can check, but the request must not disappear either. Phrases with a known word
      // ("시끄러운 노래 싫어") are handled by listedExclusions; idioms ("맛없는 거", "재미없는 노래") ask for nothing.
      const known = Object.keys(words).some(w => new RegExp(`(?<![가-힣])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(negated.phrase));
      const idiom = negated.phrase.split(/\s+/).slice(0, -1).every(t => exclusionStopWords.some(w => letters(t).startsWith(w)));
      if (!tags.length && !negated.nouns.length && !known && !idiom) unsupported.push({ kind: 'trait', text: `${negated.phrase} 제외` });
    }
    for (const word of negated.nouns) {
      const short = exclusionShortWords[word], tag = tagLabels[category].includes(word) ? word : TAG_RULES[category].find(([p]) => p.test(word))?.[1];
      if (words[word]) words[word].forEach(v => excluded.add(v));
      else if (short?.length) short.forEach(v => excluded.add(v));
      else if (tag) leaveOut(tag);
      else unsupported.push({ kind: category === 'food' ? 'ingredient' : 'exclusion', text: `${word} 제외` });
    }
  }
  return { excluded, unsupported, masked, notWanted };
}

/** What a sentence asks for that the app cannot check. Shown before recommending and never turned into another condition. */
export type Unsupported = { kind: 'price' | 'delivery' | 'place' | 'genre' | 'ingredient' | 'trait' | 'exclusion'; text: string };
export const unsupportedNote: Record<Unsupported['kind'], string> = {
  price: '가격 조건은 지원하지 않아요. 취향과 상황을 기준으로 메뉴를 추천해요.',
  delivery: '배달·포장 가능 여부는 확인하지 않아요. 판매처에서 직접 확인해주세요.',
  place: '주변 식당이나 영업 여부는 확인하지 않아요. 메뉴를 고른 뒤 지도 검색으로 찾아볼 수 있어요.',
  genre: '이 장르는 곡 정보에 분류가 없어 반영하지 못해요. 분위기·에너지·악기 조건으로 골라주세요.',
  ingredient: '등록된 재료·특징에 없어 이 제외는 반영하지 못해요. 메뉴의 재료를 직접 확인해주세요.',
  trait: '이 특징을 빼는 조건은 아직 지원하지 않아요. 원하는 조건으로도 반영하지 않았어요.',
  exclusion: '이 제외는 지원하지 않아 반영하지 못해요.',
};
// Mirrored in server/app/parsing/rules.py (shared/parse-cases.json checks both). Amounts: 8천원, 1만 5천원, 15,000원, 만원.
const AMOUNT = /(?<![가-힣\d-])(?:(?:(?:[\d,]+|[일이삼사오육칠팔구십]+)\s*)?(?:만|천)(?:\s*(?:\d+|[일이삼사오육칠팔구십]+)?\s*천)?(?:\s*\d+)?|[\d,]+)\s*원/.source;
const UNSUPPORTED_PATTERNS: [Unsupported['kind'], RegExp][] = [
  ['price', new RegExp(`(?:${AMOUNT})(?:\\s*(?:이하|이내|미만|아래|안쪽|정도|짜리|대|선|내외|까지))?|저렴\\S{0,2}|가성비|값싼|싸게|싸고|싼\\s*(?:걸|거|것|메뉴)|비싸지\\s*않\\S?|비싼|(?:가격|예산|금액)대?`, 'g')],
  ['delivery', /배달(?:\s*(?:가능한|가능하고|가능|되는|되고|되면))?|배송|포장(?!마차)(?:\s*(?:가능한|가능|되는))?|테이크\s*아웃|딜리버리|시켜\s*먹\S{0,2}/g],
  ['place', /근처|주변|동네|가까운(?:\s*(?:곳|데|식당|가게))?|영업\s*중\S{0,2}/g],
];
export function unsupportedConditions(text: string, category: Category): Unsupported[] {
  const found: Unsupported[] = [];
  if (category === 'food') for (const [kind, pattern] of UNSUPPORTED_PATTERNS) for (const m of text.matchAll(pattern)) found.push({ kind, text: m[0].trim() });
  // "힙합 말고" is reported once, as an exclusion it cannot apply (readNegations).
  const negated = negatedPhrases(text);
  if (category === 'music') for (const m of text.matchAll(UNSUPPORTED_GENRES)) if (!negated.some(n => m.index! >= n.start && m.index! < n.end)) found.push({ kind: 'genre', text: m[0].trim() });
  for (const word of listedExclusions(text, category).unsupported) found.push({ kind: 'ingredient', text: `${word} 제외` });
  found.push(...readNegations(text, category).unsupported);
  return found.filter((u, i) => found.findIndex(o => o.kind === u.kind && o.text === u.text) === i);
}
/** The values an exclusion really blocks: a group ("해산물") blocks the ingredients it covers. */
export const blockedValues = (excluded: string[]) => [...new Set(excluded.flatMap(v => [v, ...(exclusionGroups[v]?.covers || [])]))];
/** Exclusions the data checks only in part, and whether any exclusion relies on the recorded ingredients. */
export function exclusionNotes(conditions: Conditions): { partial: string[]; ingredients: boolean } {
  const partial = conditions.excluded.filter(v => exclusionGroups[v]).map(v => `${v} 제외는 등록 재료의 ${exclusionGroups[v].covers.join('·')}만 확인해 뺄 수 있어요. ${exclusionGroups[v].uncovered}은 재료 정보가 없어 직접 확인해주세요.`);
  return { partial, ingredients: conditions.excluded.some(v => excludableIngredients.includes(v) || !!exclusionGroups[v]) };
}
export function createEditor(raw: string, category: Category): ConditionEditor {
  return { parsedRaw: raw, automatic: parseConditions(raw, category), manual: emptyConditions(), removedTags: [], removedExcluded: [] };
}
function editorFor(session: Session): ConditionEditor {
  // Older requests and historical conditions are explicit values, never invented history.
  return session.editor || { ...createEditor(session.raw, session.category), automatic: emptyConditions(), manual: cleanConditions(session.conditions) };
}
export function effectiveConditions(editor: ConditionEditor): Conditions {
  const excluded = [...new Set([...editor.automatic.excluded.filter(t => !editor.removedExcluded.includes(t)), ...editor.manual.excluded])];
  const tags = [...new Set([...editor.automatic.tags.filter(t => !editor.removedTags.includes(t) && !excluded.includes(t)), ...editor.manual.tags])];
  return { tags, excluded };
}
export function changeText(session: Session, raw: string): Session {
  const old = editorFor(session);
  const editor = old.parsedRaw === raw ? old : { ...old, parsedRaw: raw, automatic: parseConditions(raw, session.category), removedTags: [], removedExcluded: [] };
  return { ...session, raw, editor, conditions: effectiveConditions(editor), revision: 0, currentIds: old.parsedRaw === raw ? session.currentIds : undefined, snapshot: old.parsedRaw === raw ? session.snapshot : undefined };
}
/** Replaces the automatic conditions of an unchanged sentence with the server's reading (rules + AI). */
export function applyParsed(session: Session, raw: string, automatic: Conditions | null, ai: NonNullable<ConditionEditor['ai']>): Session {
  if (session.raw !== raw || !session.editor || session.editor.parsedRaw !== raw) return session;
  const editor = { ...session.editor, ...(automatic ? { automatic: structuredClone(automatic) } : {}), ai };
  return { ...session, editor, conditions: effectiveConditions(editor), revision: 0, ...(automatic ? { currentIds: undefined, snapshot: undefined } : {}) };
}
export function toggleCondition(session: Session, value: string, exclusion = false): Session {
  const editor = structuredClone(editorFor(session));
  const key = exclusion ? 'excluded' : 'tags';
  const removed = exclusion ? 'removedExcluded' : 'removedTags';
  if (session.conditions[key].includes(value)) {
    editor.manual[key] = editor.manual[key].filter(t => t !== value);
    editor[removed] = [...new Set([...editor[removed], value])];
  } else {
    editor.manual[key] = [...new Set([...editor.manual[key], value])];
    editor[removed] = editor[removed].filter(t => t !== value);
  }
  return { ...session, editor, conditions: effectiveConditions(editor), revision: 0, currentIds: undefined, snapshot: undefined };
}
export function conditionConflicts(session: Session): string[] {
  const conflicts = session.conditions.tags.filter(t => session.conditions.excluded.includes(t));
  if (session.conditions.tags.includes('연주곡') && session.conditions.tags.includes('보컬')) conflicts.push('연주곡과 보컬');
  if (session.editor?.manual.tags.some(t => session.editor!.automatic.excluded.includes(t) && !session.editor!.removedExcluded.includes(t))) conflicts.push('직접 선택과 문장의 제외 조건');
  return [...new Set(conflicts)];
}
// The local recommender: offline mode and the fallback when the API server cannot answer.
export function recommend(session: Session, profile: Profile, catalog: Item[] = catalogItems()): Recommendation[] {
  if (session.snapshot) {
    const eligible = new Set(eligibleCandidates(session, profile, catalog).map(i => i.id));
    return withContrast(session.snapshot.filter(r => eligible.has(r.item.id)));
  }
  const { category, conditions } = session;
  const preferred = new Set([...profile.tags, ...catalog.filter(i => profile.selected.includes(i.id)).flatMap(i => i.tags)]);
  const candidates = eligibleCandidates(session, profile, catalog);
  const score = (i: Item) => i.tags.filter(t => preferred.has(t)).length + 2 * i.tags.filter(t => conditions.tags.includes(t)).length;
  const ranked = candidates.sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
  const seen = new Set(session.seenIds || []);
  const pinned=new Set(session.pinnedIds || []);
  const ordered = session.currentIds ? session.currentIds.map(id => ranked.find(i => i.id === id)).filter((i): i is Item => !!i) : [...ranked.filter(i=>pinned.has(i.id)),...ranked.filter(i => !pinned.has(i.id) && !seen.has(i.id)), ...ranked.filter(i => !pinned.has(i.id) && seen.has(i.id))];
  const count = category === 'food' ? 3 : 5;
  const relevant = (i: Item) => !conditions.tags.length || i.tags.some(t => conditions.tags.includes(t));
  const picked = (session.currentIds ? ordered : capFamiliar(ordered, profile.selected, pinned, relevant, seen)).slice(0, count);
  return withContrast(picked.map(item => ({ item, ...templateReasons(item, profile, preferred, conditions, category) })));
}

/** Order of a round (server/app/retrieval/select.py applies the same rule):
 * 1. pinned cards; 2. candidates not yet seen in this request; 3. seen ones, only when unseen ones run out.
 * Inside tiers 2 and 3: candidates matching a wanted tag, with at most one registered favourite per round (they would
 * otherwise fill the list: 3 of 5 songs, 2026-10-27), then the other favourites, then candidates matching no wanted tag.
 * Wanted tags rank, they do not filter, so an unseen off-topic card still comes before a repeat — and says it does not
 * match (conditionChecks, the off-topic notice). */
export const FAMILIAR_LIMIT = 1;
export function capFamiliar<T extends { id: string }>(ordered: T[], liked: string[], pinned: Set<string> = new Set(), relevant: (item: T) => boolean = () => true, seen: Set<string> = new Set()): T[] {
  let familiar = ordered.filter(i => pinned.has(i.id) && liked.includes(i.id)).length;
  const arrange = (tier: T[]) => {
    const kept: T[] = [], deferred: T[] = [], offTopic: T[] = [];
    for (const i of tier) {
      if (!relevant(i)) offTopic.push(i);
      else if (!liked.includes(i.id)) kept.push(i);
      else if (familiar < FAMILIAR_LIMIT) { familiar++; kept.push(i); }
      else deferred.push(i);
    }
    return [...kept, ...deferred, ...offTopic];
  };
  const rest = ordered.filter(i => !pinned.has(i.id));
  return [...ordered.filter(i => pinned.has(i.id)), ...arrange(rest.filter(i => !seen.has(i.id))), ...arrange(rest.filter(i => seen.has(i.id)))];
}

// Reason templates, worded exactly like server/app/retrieval/reasons.py. They say what is true of this card alone and
// never claim a taste that was not registered; how it differs from the others is contrastReason's job.
const FOOD_TRAIT_WORDS: Record<string, string> = { 매콤함: '매콤한', 담백함: '담백한', 고소함: '고소한', 상큼함: '상큼한', 따뜻함: '따뜻한', 차가움: '차가운', 국물: '국물 있는', 채소: '채소가 많은' };
const MUSIC_DISTINCT = ['재즈', '피아노', '어쿠스틱', '록', '발라드', '팝', '연주곡', '보컬'];
export const NO_TASTE_REASON = '등록된 취향이 없어 취향은 반영하지 않았어요';
export function templateReasons(item: Item, profile: Profile, preferred: Set<string>, conditions: Conditions, category: Category) {
  const taste = item.tags.filter(t => preferred.has(t)).slice(0, 2);
  const tasteReason = !profile.selected.length && !profile.tags.length ? NO_TASTE_REASON
    : profile.selected.includes(item.id) ? `내 취향에 등록한 ${category === 'food' ? '메뉴예요' : '곡이에요'}`
    : taste.length ? `좋아하는 ${taste.join(' · ')}에 가까워요` : '평소 취향과 다른 새로운 선택이에요';
  const matched = item.tags.filter(t => conditions.tags.includes(t)).slice(0, 2);
  const contextReason = matched.length ? `이번 조건 ${matched.join(' · ')}에 맞아요.` : conditions.tags.length ? '고른 조건과 겹치는 특징은 적어요.' : conditions.excluded.length ? '등록 정보 기준으로 제외 조건을 적용했어요.' : '상황 조건 없이 골랐어요.';
  return { tasteReason, contextReason };
}
/** What only this card has among the cards shown with it, from its tags; empty when nothing sets it apart. */
export function contrastReason(item: Item, shown: Item[]): string {
  const others = shown.filter(o => o.id !== item.id);
  if (!others.length) return '';
  const unique = (values: string[]) => values.filter(t => item.tags.includes(t) && !others.some(o => o.tags.includes(t)));
  if (item.category === 'food') { const words = unique(Object.keys(FOOD_TRAIT_WORDS)).map(t => FOOD_TRAIT_WORDS[t]); return words.length ? `추천 중 유일하게 ${words.join(', ')} 메뉴예요.` : ''; }
  const [tag] = unique(MUSIC_DISTINCT);
  return tag ? `추천 중 유일한 ${tag} 곡이에요.` : '';
}
/** Recomputes every card's contrast for exactly this set of cards (after a batch, a replacement or a card leaving). */
export function withContrast(results: Recommendation[]): Recommendation[] {
  const shown = results.map(r => r.item);
  return results.map(({ contrast: _old, ...r }) => { const contrast = contrastReason(r.item, shown); return contrast ? { ...r, contrast } : r; });
}

export function eligibleCandidates(session: Session, profile: Profile, catalog: Item[] = catalogItems()): Item[] {
  return catalog.filter(i => i.category === session.category && !profile.disliked.includes(i.id) && !session.excludedIds.includes(i.id)
    && (session.candidateScope !== 'favorites' || (session.candidateIds || []).includes(i.id))
    && !blockedValues(session.conditions.excluded).some(t => [...i.tags, ...i.ingredients].includes(t)));
}
/** Starts a new round from results computed locally or by the API server. */
export function applyBatch(session: Session, results: Recommendation[]): Session {
  const before = new Set(session.seenIds || []);
  const snapshot = withContrast(structuredClone(results));
  const currentIds = snapshot.map(r => r.item.id);
  return { ...session, id: session.id || crypto.randomUUID(), roundId: crypto.randomUUID(), snapshot, currentIds, pinnedIds:(session.pinnedIds || []).filter(id=>currentIds.includes(id)),compareIds:(session.compareIds || []).filter(id=>currentIds.includes(id)),seenIds: [...new Set([...before, ...currentIds])], batchNewCount: currentIds.filter(id => !before.has(id)).length, repeatIds: currentIds.filter(id => before.has(id)) };
}
export function nextBatch(session: Session, profile: Profile): Session {
  return applyBatch(session, recommend({ ...session, currentIds: undefined, snapshot: undefined }, profile));
}
/** The request for a single replacement: current cards are excluded and nothing stays pinned. */
export function replacementRequest(session: Session, current: Recommendation[]): Session {
  return {...session,currentIds:undefined,snapshot:undefined,pinnedIds:[],excludedIds:[...session.excludedIds,...current.map(r=>r.item.id)]};
}
export function canReplace(session: Session, current: Recommendation[], id: string): boolean {
  return !session.pinnedIds?.includes(id) && current.some(r=>r.item.id===id);
}
/** Swaps one card for the first candidate not yet seen in this request; null when there is none. */
export function applyReplacement(session:Session,current:Recommendation[],id:string,candidates:Recommendation[]):Session|null {
  const replacement=candidates.find(r=>!session.seenIds?.includes(r.item.id));
  if(!replacement)return null;
  // The replacement's reasons were written for another set; every card's contrast is redone for the cards now shown.
  const snapshot=withContrast(structuredClone(current.map(r=>r.item.id===id?replacement:r)));
  return {...session,snapshot,currentIds:snapshot.map(r=>r.item.id),seenIds:[...new Set([...(session.seenIds || []),...snapshot.map(r=>r.item.id)])],compareIds:(session.compareIds || []).filter(v=>v!==id),roundId:crypto.randomUUID(),revision:session.revision+1,
    // The cards kept from this round are not repeats; only earlier repeats still on screen stay counted.
    batchNewCount:snapshot.length-(session.repeatIds || []).filter(r=>r!==id).length,repeatIds:(session.repeatIds || []).filter(r=>r!==id)};
}
export function replaceCandidate(session:Session,profile:Profile,id:string):Session|null {
  const current=recommend(session,profile);
  if(!canReplace(session,current,id))return null;
  return applyReplacement(session,current,id,recommend(replacementRequest(session,current),profile));
}
export function candidateInfo(session: Session, profile: Profile, catalog: Item[] = catalogItems()) {
  return { count: eligibleCandidates(session, profile, catalog).length };
}
/** How one card meets each condition of the request, for comparing cards at a glance.
 * - Wanted situations and moods ("want") only rank candidates. "met" means the item's registered tags include it;
 *   "untagged" only means they do not, which is not the same as not fitting: an AI reason may still judge that it fits
 *   from the description ("과제할 때 어울려요" for a song without the 과제 tag, 2026-10-27). No tag is ever inferred here.
 * - Exclusions ("exclude") filter candidates by the registered ingredients and tags ("met" = applied on that data, not a
 *   guarantee about the real dish); a group the data only covers in part ("해산물") stays "partial". Exclusions the data
 *   cannot check at all (국물, 고수) never become conditions; ConditionNotes names them as unsupported. */
export type ConditionCheck = { label: string; value: string; kind: 'want' | 'exclude'; state: 'met' | 'untagged' | 'partial' };
export function conditionChecks(item: Item, conditions: Conditions): ConditionCheck[] {
  return [...conditions.tags.map(t => ({ label: t, value: t, kind: 'want' as const, state: item.tags.includes(t) ? 'met' as const : 'untagged' as const })),
    ...conditions.excluded.map(v => ({ value: v, kind: 'exclude' as const, ...exclusionGroups[v] ? { label: `${v} 일부 확인`, state: 'partial' as const } : { label: v === '매콤함' ? '맵지 않음' : `${v} 제외`, state: 'met' as const } }))];
}
/** What a check says, for screen readers and the comparison table. A partial exclusion never reads as applied. */
export function checkText(c: ConditionCheck): string {
  if (c.kind === 'exclude') return c.state === 'partial' ? `${c.value} 제외 일부만 확인` : `${c.label}, 등록 정보 기준 적용`;
  return c.state === 'met' ? `${c.label} 특징 있음` : `${c.label} 특징 미등록(데이터에 표시 없음)`;
}
