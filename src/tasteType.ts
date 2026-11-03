import type { Category, Item } from './data';
import type { Session, YearRange } from './domain';

// The taste type test in the lab (2026-11-03): an MBTI-style four-letter code for food and for music. Light fun, not a measurement:
// the code picks a name and a sentence for the AI to read. Each axis has two questions; a tie goes to the first answer.
export type Axis = { a: string; b: string; aLabel: string; bLabel: string; aWish: string; bWish: string; tags: [string | null, string | null]; aMatch: string[]; bMatch: string[] };
export type Question = { axis: number; text: string; a: string; b: string };
export type TasteTypeResult = { code: string; date: string; source: 'quiz' | 'taste' };

export const AXES: Record<Category, Axis[]> = {
  food: [
    { a: 'S', b: 'M', aLabel: '자극적인 맛', bLabel: '순한 맛', aWish: '얼큰하고 자극적인 맛', bWish: '순하고 담백한 맛', tags: ['매콤함', '담백함'], aMatch: ['매콤함'], bMatch: ['담백함'] },
    { a: 'H', b: 'L', aLabel: '든든하게', bLabel: '가볍게', aWish: '배부르고 든든한 메뉴', bWish: '가볍고 산뜻한 메뉴', tags: ['고소함', '채소'], aMatch: ['고소함', '국물'], bMatch: ['채소', '상큼함', '차가움'] },
    { a: 'T', b: 'N', aLabel: '익숙한 메뉴', bLabel: '새로운 메뉴', aWish: '익숙한 메뉴', bWish: '평소 잘 안 먹어 본 새로운 메뉴', tags: [null, null], aMatch: ['한식', '분식'], bMatch: ['아시안', '양식', '일식', '중식'] },
    { a: 'A', b: 'G', aLabel: '혼자서', bLabel: '여럿이', aWish: '혼자 먹기 좋은 메뉴', bWish: '여럿이 나눠 먹기 좋은 메뉴', tags: ['혼자', '함께'], aMatch: ['혼자'], bMatch: ['함께'] },
  ],
  music: [
    { a: 'E', b: 'C', aLabel: '신나게', bLabel: '차분하게', aWish: '에너지가 넘치는 곡', bWish: '차분하고 잔잔한 곡', tags: ['활기참', '차분함'], aMatch: ['활기참', '높은 에너지'], bMatch: ['차분함', '낮은 에너지'] },
    { a: 'V', b: 'I', aLabel: '노래 중심', bLabel: '연주 중심', aWish: '목소리와 가사가 중심인 곡', bWish: '악기 연주가 중심인 곡', tags: ['보컬', '연주곡'], aMatch: ['보컬', '발라드'], bMatch: ['연주곡', '피아노', '재즈'] },
    { a: 'R', b: 'N', aLabel: '옛 노래', bLabel: '요즘 노래', aWish: '시간이 지나도 사랑받는 옛 노래', bWish: '요즘 나온 노래', tags: [null, null], aMatch: [], bMatch: [] },
    { a: 'F', b: 'B', aLabel: '집중해서 듣기', bLabel: '틀어 두기', aWish: '집중해서 듣기 좋은 곡', bWish: '무언가 하면서 틀어 두기 좋은 곡', tags: [null, null], aMatch: [], bMatch: ['과제', '산책', '운동', '휴식'] },
  ],
};

export const QUESTIONS: Record<Category, Question[]> = {
  food: [
    { axis: 0, text: '메뉴판 앞에서 더 끌리는 쪽은?', a: '빨간 국물, 얼큰한 맛', b: '맑은 국물, 순한 맛' },
    { axis: 1, text: '점심을 먹고 난 뒤 바라는 건?', a: '든든해서 오후를 버티는 것', b: '가벼워서 졸리지 않는 것' },
    { axis: 2, text: '처음 가는 식당에서는?', a: '늘 먹던 익숙한 메뉴', b: '처음 보는 메뉴' },
    { axis: 3, text: '기억에 남는 식사는?', a: '혼자 여유롭게 먹은 날', b: '여럿이 왁자지껄 먹은 날' },
    { axis: 0, text: '스트레스 받은 날에는?', a: '매운 걸로 푼다', b: '속 편한 걸로 달랜다' },
    { axis: 1, text: '한 끼의 모습을 고른다면?', a: '밥과 고기가 넉넉한 한 상', b: '샐러드나 샌드위치처럼 산뜻하게' },
    { axis: 2, text: '여행지에서는?', a: '믿고 먹는 아는 맛', b: '현지 음식 도전' },
    { axis: 3, text: '메뉴를 고를 때 먼저 떠올리는 건?', a: '내가 지금 먹고 싶은 것', b: '같이 나눠 먹기 좋은 것' },
  ],
  music: [
    { axis: 0, text: '플레이리스트를 튼다면?', a: '기분을 끌어올리는 곡', b: '마음을 가라앉히는 곡' },
    { axis: 1, text: '노래에서 먼저 들리는 건?', a: '목소리와 가사', b: '악기와 사운드' },
    { axis: 2, text: '오늘 듣고 싶은 건?', a: '오래 들어 온 명곡', b: '이번 달 나온 신곡' },
    { axis: 3, text: '음악을 들을 때 나는?', a: '음악에만 집중한다', b: '다른 일을 하며 틀어 둔다' },
    { axis: 0, text: '공연장에서 더 좋은 순간은?', a: '다 같이 뛰는 순간', b: '조용히 숨죽이는 순간' },
    { axis: 1, text: '하루 종일 한쪽만 듣는다면?', a: '노래', b: '연주곡' },
    { axis: 2, text: '친구에게 추천한다면?', a: '내가 예전부터 아끼는 곡', b: '요즘 빠진 새로운 곡' },
    { axis: 3, text: '좋은 곡을 발견하면?', a: '앨범을 처음부터 끝까지 듣는다', b: '플레이리스트에 넣어 둔다' },
  ],
};

export const TYPE_NAMES: Record<Category, Record<string, string>> = {
  food: {
    SHTA: '혼밥 국밥 장인', SHTG: '얼큰한 회식 대장', SHNA: '매운맛 탐험가', SHNG: '마라 원정대장',
    SLTA: '칼칼한 한 그릇파', SLTG: '매콤한 분식 메이트', SLNA: '향신료 산책자', SLNG: '타코 파티 플래너',
    MHTA: '든든한 집밥 수호자', MHTG: '푸짐한 한상 주인장', MHNA: '담백한 미식 연구가', MHNG: '코스 요리 안내자',
    MLTA: '맑은 국물 명상가', MLTG: '소풍 도시락 담당', MLNA: '샐러드 실험가', MLNG: '브런치 모임장',
  },
  music: {
    EVRF: '떼창하는 레트로 팬', EVRB: '추억 플레이리스트 DJ', EVNF: '신곡 첫 재생러', EVNB: '운동 부스터 큐레이터',
    EIRF: '전설의 라이브 감상가', EIRB: '그루브 타는 작업자', EINF: '사운드 탐험가', EINB: '비트로 달리는 러너',
    CVRF: '가사 곱씹는 낭만파', CVRB: '밤 라디오 청취자', CVNF: '감성 신곡 수집가', CVNB: '카페 플레이리스트 주인',
    CIRF: '재즈바 단골', CIRB: '오후의 LP 애호가', CINF: '앰비언트 탐구자', CINB: '집중 모드 장인',
  },
};

/** The code from one answer per question ('a' or 'b'), in QUESTIONS order. A tie on an axis goes to its first question. */
export function codeFromAnswers(category: Category, answers: ('a' | 'b')[]): string {
  return AXES[category].map((axis, n) => {
    const own = QUESTIONS[category].flatMap((q, i) => q.axis === n ? [answers[i]] : []);
    const a = own.filter(x => x === 'a').length, b = own.length - a;
    return a > b || (a === b && own[0] === 'a') ? axis.a : axis.b;
  }).join('');
}

/** The minimum of liked items that says anything; below it the test is the only way. */
export const MIN_ITEMS_FOR_TYPE = 3;
/** The code the registered items lean to, from their tags; an axis with no signal takes its second side only if that side has any. */
export function codeFromItems(category: Category, liked: Pick<Item, 'tags' | 'releaseYear'>[], now = new Date().getFullYear()): string | undefined {
  if (liked.length < MIN_ITEMS_FOR_TYPE) return undefined;
  return AXES[category].map(axis => {
    const count = (words: string[]) => liked.filter(i => words.some(w => i.tags.includes(w))).length;
    if (axis.a === 'R') return liked.filter(i => i.releaseYear !== undefined && i.releaseYear < now - 10).length * 2 >= liked.filter(i => i.releaseYear !== undefined).length ? axis.a : axis.b;
    return count(axis.aMatch) >= count(axis.bMatch) ? axis.a : axis.b;
  }).join('');
}

export const typeName = (category: Category, code: string) => TYPE_NAMES[category][code] || code;
export const sides = (category: Category, code: string) => AXES[category].map((axis, n) => code[n] === axis.a ? { letter: axis.a, label: axis.aLabel, wish: axis.aWish, tag: axis.tags[0] } : { letter: axis.b, label: axis.bLabel, wish: axis.bWish, tag: axis.tags[1] });

/** A request in the type's words: the sentence is for the AI, the tags and years are the checkable part. */
export function requestForType(category: Category, code: string, now = new Date().getFullYear()): Pick<Session, 'raw' | 'conditions' | 'years'> {
  const parts = sides(category, code);
  const years: YearRange | undefined = category !== 'music' ? undefined : code[2] === 'R' ? { to: now - 10 } : { from: now - 2 };
  return { raw: parts.map(p => p.wish).join(', ').slice(0, 280) + ' 위주로 추천해줘', conditions: { tags: parts.flatMap(p => p.tag ? [p.tag] : []), excluded: [] }, ...(years ? { years } : {}) };
}
