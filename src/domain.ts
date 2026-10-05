import { items, type Category, type Item } from './data';
export type Profile = { selected: string[]; tags: string[]; disliked: string[] };
export type Conditions = { tags: string[]; excluded: string[]; maxPrice: number | null };
export type Session = { category: Category; raw: string; conditions: Conditions; excludedIds: string[]; revision: number };
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
    if (/만원|만 원|10,?000원/.test(text)) condition.maxPrice = 10000;
  } else if (/보컬.?없|가사.?없|보컬.{0,5}(제외|싫)/.test(text)) condition.excluded.push('보컬');
  return condition;
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
