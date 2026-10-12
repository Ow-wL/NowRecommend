import { items, type Category, type Item } from './data';
export type Profile = { selected: string[]; tags: string[]; disliked: string[] };
export type Conditions = { tags: string[]; excluded: string[]; maxPrice: number | null };
export type ConditionEditor = { parsedRaw: string; automatic: Conditions; manual: Conditions; removedTags: string[]; removedExcluded: string[]; budgetInput?: string };
export type Session = { category: Category; raw: string; conditions: Conditions; excludedIds: string[]; revision: number; editor?: ConditionEditor };
export type Recommendation = { item: Item; tasteReason: string; contextReason: string };
export type HistoryEntry = { id: string; date: string; category: Category; raw: string; conditions: Conditions; resultIds: string[] };
export type Store = { version: 1; name: string; profiles: Record<Category, Profile>; favorites: string[]; history: HistoryEntry[] };
export const emptyProfile = (): Profile => ({ selected: [], tags: [], disliked: [] });
export const emptyStore = (): Store => ({ version: 1, name: '취향 탐험가', profiles: { food: emptyProfile(), music: emptyProfile() }, favorites: [], history: [] });
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
    for (const ingredient of ['소고기', '돼지고기', '닭고기', '생선', '밀', '땅콩', '유제품', '버섯', '달걀', '콩']) {
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
  return { ...session, raw, editor, conditions: effectiveConditions(editor), revision: 0 };
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
  return { ...session, editor, conditions: effectiveConditions(editor), revision: 0 };
}
export function changeBudget(session: Session, input: string): Session {
  const editor = { ...editorFor(session), budgetInput: input };
  return { ...session, editor, conditions: effectiveConditions(editor), revision: 0 };
}
export function conditionConflicts(session: Session): string[] {
  const conflicts = session.conditions.tags.filter(t => session.conditions.excluded.includes(t));
  if (session.conditions.tags.includes('연주곡') && session.conditions.tags.includes('보컬')) conflicts.push('연주곡과 보컬');
  if (session.editor?.manual.tags.some(t => session.editor!.automatic.excluded.includes(t) && !session.editor!.removedExcluded.includes(t))) conflicts.push('직접 선택과 문장의 제외 조건');
  return [...new Set(conflicts)];
}
export function recommend(session: Session, profile: Profile): Recommendation[] {
  const { category, conditions, excludedIds, revision } = session;
  const preferred = new Set([...profile.tags, ...items.filter(i => profile.selected.includes(i.id)).flatMap(i => i.tags)]);
  const candidates = items.filter(i => i.category === category && !profile.disliked.includes(i.id) && !excludedIds.includes(i.id)
    && !conditions.excluded.some(t => [...i.tags, ...i.ingredients].includes(t))
    && (conditions.maxPrice === null || (i.cost ?? 0) <= conditions.maxPrice));
  const score = (i: Item) => i.tags.filter(t => preferred.has(t)).length + 2 * i.tags.filter(t => conditions.tags.includes(t)).length;
  const ranked = candidates.sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
  // Keep context matches ahead of unrelated candidates; rotate among eligible matches for variety.
  const matched = ranked.filter(i => !conditions.tags.length || i.tags.some(t => conditions.tags.includes(t)));
  const pool = matched.length ? matched : ranked;
  const offset = pool.length ? (revision * (category === 'food' ? 3 : 5)) % pool.length : 0;
  const rotated = [...pool.slice(offset), ...pool.slice(0, offset)];
  return rotated.slice(0, category === 'food' ? 3 : 5).map(item => {
    const taste = item.tags.filter(t => preferred.has(t)).slice(0, 2);
    const context = item.tags.filter(t => conditions.tags.includes(t)).slice(0, 2);
    return { item, tasteReason: taste.length ? `좋아하는 ${taste.join(' · ')}에 가까워요` : '새로운 취향을 발견해보세요',
      contextReason: context.length ? `이번에 고른 ${context.join(' · ')}에 어울려요` : '제외 조건을 지키는 새로운 선택이에요' };
  });
}
