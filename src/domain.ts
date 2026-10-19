import { excludableIngredients, type Category, type Item } from './data';
import { getCatalog } from './catalog';

const catalogItems = () => getCatalog().items;
export type Profile = { selected: string[]; tags: string[]; disliked: string[] };
export type Conditions = { tags: string[]; excluded: string[]; maxPrice: number | null };
export type ConditionEditor = { parsedRaw: string; automatic: Conditions; manual: Conditions; removedTags: string[]; removedExcluded: string[]; budgetInput?: string };
export type Session = { category: Category; raw: string; conditions: Conditions; excludedIds: string[]; revision: number; editor?: ConditionEditor; seenIds?: string[]; currentIds?: string[]; batchNewCount?: number; id?: string; roundId?: string; snapshot?: Recommendation[]; candidateScope?: 'favorites'; candidateIds?: string[]; pinnedIds?: string[]; compareIds?:string[]; source?: 'server' | 'local' };
export type Recommendation = { item: Item; tasteReason: string; contextReason: string };
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
export const emptyConditions = (): Conditions => ({ tags: [], excluded: [], maxPrice: null });
export function updateFeedback(profile: Profile, session: Session, id: string, scope: 'session' | 'long') {
  return { profile: scope === 'long' ? { ...profile, disliked: [...new Set([...profile.disliked, id])] } : profile,
    session: scope === 'session' ? { ...session, excludedIds: [...new Set([...session.excludedIds, id])] } : session };
}
// The prototype only maps known phrases. It never calls an AI service.
export function parseConditions(text: string, category: Category): Conditions {
  const condition = emptyConditions();
  const rules: [RegExp, string][] = category === 'food'
    ? [[/혼자|혼밥/, '혼자'], [/함께|친구|둘이/, '함께'], [/저녁/, '저녁'], [/점심/, '점심'], [/담백|순한|부담.?없/, '담백함'], [/매콤|매운|칼칼|얼큰/, '매콤함'], [/고소/, '고소함'], [/따뜻|따끈/, '따뜻함'], [/시원|차가운/, '차가움'], [/국물/, '국물'], [/채소|야채/, '채소']]
    : [[/과제|공부|집중|작업/, '과제'], [/휴식|쉬|잠|편안/, '휴식'], [/산책|걷/, '산책'], [/운동|달리|러닝/, '운동'], [/잔잔|차분|조용/, '차분함'], [/활기|신나|밝은/, '활기참'], [/적당히|적당한/, '중간 에너지'], [/연주곡|보컬.?없|가사.?없/, '연주곡'], [/재즈/, '재즈'], [/피아노/, '피아노'], [/어쿠스틱/, '어쿠스틱']];
  for (const [pattern, value] of rules) if (pattern.test(text)) condition.tags.push(value);
  if (category === 'food') {
    if (/안\s*매운|맵지\s*않|매운.{0,5}(제외|싫|피하|말고)/.test(text)) { condition.excluded.push('매콤함'); condition.tags = condition.tags.filter(t => t !== '매콤함'); }
    for (const ingredient of excludableIngredients) {
      if (new RegExp(`(?<![가-힣])${ingredient}.{0,6}(제외|빼|피하|싫|없이|알레르기)`).test(text)) condition.excluded.push(ingredient);
    }
    condition.maxPrice = parseAmount(text);
  } else if (/보컬.?없|가사.?없|보컬.{0,5}(제외|싫)/.test(text)) condition.excluded.push('보컬');
  return condition;
}

function smallNumber(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  const digits: Record<string, number> = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };
  if (value.includes('십')) { const [tens, ones] = value.split('십'); return (digits[tens] || 1) * 10 + (digits[ones] || 0); }
  return digits[value] || 1;
}
export function parseAmount(text: string): number | null {
  const match = text.match(/(?<![가-힣\d-])((?:(?:[\d,]+|[일이삼사오육칠팔구십]+)\s*)?(?:만|천)(?:\s*(?:\d+|[일이삼사오육칠팔구십]+)?\s*천)?(?:\s*\d+)?|[\d,]+)\s*원/);
  if (!match) return null;
  let source = match[1].replace(/[\s,]/g, '');
  let amount = 0;
  for (const [unit, multiplier] of [['만', 10000], ['천', 1000]] as const) {
    if (source.includes(unit)) { const split = source.split(unit); amount += smallNumber(split[0]) * multiplier; source = split[1]; }
  }
  amount += source ? smallNumber(source) : 0;
  return amount >= 100 && amount <= 1000000 ? amount : null;
}
export function validateBudget(input: string): string | null {
  if (!input.trim()) return null;
  if (!/^\d+$/.test(input.trim()) || Number(input) < 100 || Number(input) > 1000000) return '예산은 100~1,000,000원의 정수로 입력해주세요.';
  return null;
}
export function createEditor(raw: string, category: Category): ConditionEditor {
  return { parsedRaw: raw, automatic: parseConditions(raw, category), manual: emptyConditions(), removedTags: [], removedExcluded: [] };
}
function editorFor(session: Session): ConditionEditor {
  // Older requests and historical conditions are explicit values, never invented history.
  return session.editor || { ...createEditor(session.raw, session.category), automatic: emptyConditions(), manual: structuredClone(session.conditions), budgetInput: session.conditions.maxPrice === null ? '' : String(session.conditions.maxPrice) };
}
export function effectiveConditions(editor: ConditionEditor): Conditions {
  const excluded = [...new Set([...editor.automatic.excluded.filter(t => !editor.removedExcluded.includes(t)), ...editor.manual.excluded])];
  const tags = [...new Set([...editor.automatic.tags.filter(t => !editor.removedTags.includes(t) && !excluded.includes(t)), ...editor.manual.tags])];
  const maxPrice = editor.budgetInput === undefined ? editor.automatic.maxPrice : editor.budgetInput.trim() && !validateBudget(editor.budgetInput) ? Number(editor.budgetInput) : null;
  return { tags, excluded, maxPrice };
}
export function changeText(session: Session, raw: string): Session {
  const old = editorFor(session);
  const editor = old.parsedRaw === raw ? old : { ...old, parsedRaw: raw, automatic: parseConditions(raw, session.category), removedTags: [], removedExcluded: [] };
  return { ...session, raw, editor, conditions: effectiveConditions(editor), revision: 0, currentIds: old.parsedRaw === raw ? session.currentIds : undefined, snapshot: old.parsedRaw === raw ? session.snapshot : undefined };
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
export function changeBudget(session: Session, input: string): Session {
  const editor = { ...editorFor(session), budgetInput: input };
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
    return session.snapshot.filter(r => eligible.has(r.item.id));
  }
  const { category, conditions } = session;
  const preferred = new Set([...profile.tags, ...catalog.filter(i => profile.selected.includes(i.id)).flatMap(i => i.tags)]);
  const candidates = eligibleCandidates(session, profile, catalog);
  const score = (i: Item) => i.tags.filter(t => preferred.has(t)).length + 2 * i.tags.filter(t => conditions.tags.includes(t)).length;
  const ranked = candidates.sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
  const seen = new Set(session.seenIds || []);
  const pinned=new Set(session.pinnedIds || []);
  const pool = session.currentIds ? session.currentIds.map(id => ranked.find(i => i.id === id)).filter((i): i is Item => !!i) : [...ranked.filter(i=>pinned.has(i.id)),...ranked.filter(i => !pinned.has(i.id) && !seen.has(i.id)), ...ranked.filter(i => !pinned.has(i.id) && seen.has(i.id))];
  return pool.slice(0, category === 'food' ? 3 : 5).map(item => {
    const taste = item.tags.filter(t => preferred.has(t)).slice(0, 2);
    const context = item.tags.filter(t => conditions.tags.includes(t)).slice(0, 2);
    return { item, tasteReason: taste.length ? `좋아하는 ${taste.join(' · ')}에 가까워요` : '새로운 취향을 발견해보세요',
      contextReason: context.length ? `이번에 고른 ${context.join(' · ')}에 어울려요` : '제외 조건을 지키는 새로운 선택이에요' };
  });
}

export function eligibleCandidates(session: Session, profile: Profile, catalog: Item[] = catalogItems()): Item[] {
  return catalog.filter(i => i.category === session.category && !profile.disliked.includes(i.id) && !session.excludedIds.includes(i.id)
    && (session.candidateScope !== 'favorites' || (session.candidateIds || []).includes(i.id))
    && !session.conditions.excluded.some(t => [...i.tags, ...i.ingredients].includes(t))
    && (session.conditions.maxPrice === null || typeof i.cost === 'number' && i.cost <= session.conditions.maxPrice));
}
/** Starts a new round from results computed locally or by the API server. */
export function applyBatch(session: Session, results: Recommendation[]): Session {
  const before = new Set(session.seenIds || []);
  const snapshot = structuredClone(results);
  const currentIds = snapshot.map(r => r.item.id);
  return { ...session, id: session.id || crypto.randomUUID(), roundId: crypto.randomUUID(), snapshot, currentIds, pinnedIds:(session.pinnedIds || []).filter(id=>currentIds.includes(id)),compareIds:(session.compareIds || []).filter(id=>currentIds.includes(id)),seenIds: [...new Set([...before, ...currentIds])], batchNewCount: currentIds.filter(id => !before.has(id)).length };
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
  const snapshot=structuredClone(current.map(r=>r.item.id===id?replacement:r));
  return {...session,snapshot,currentIds:snapshot.map(r=>r.item.id),seenIds:[...new Set([...(session.seenIds || []),...snapshot.map(r=>r.item.id)])],compareIds:(session.compareIds || []).filter(v=>v!==id),roundId:crypto.randomUUID(),revision:session.revision+1,batchNewCount:1};
}
export function replaceCandidate(session:Session,profile:Profile,id:string):Session|null {
  const current=recommend(session,profile);
  if(!canReplace(session,current,id))return null;
  return applyReplacement(session,current,id,recommend(replacementRequest(session,current),profile));
}
export function candidateInfo(session: Session, profile: Profile, catalog: Item[] = catalogItems()) {
  const count = eligibleCandidates(session, profile, catalog).length;
  const beforeBudget = eligibleCandidates({ ...session, conditions: { ...session.conditions, maxPrice: null } }, profile, catalog).length;
  const max = session.conditions.maxPrice;
  const budgets = [...new Set(catalog.filter(i => i.category === 'food' && typeof i.cost === 'number' && max !== null && i.cost > max).map(i => i.cost!))].sort((a,b) => a-b);
  const suggestions = session.category === 'food' && max !== null ? budgets.map(price => ({ price, gain: eligibleCandidates({ ...session, conditions: { ...session.conditions, maxPrice: price } }, profile, catalog).length - count })).filter(s => s.gain > 0).slice(0,3) : [];
  return { count, budgetRemoved: beforeBudget - count, suggestions };
}
