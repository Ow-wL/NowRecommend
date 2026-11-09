import type { Category, Item } from './data';
import type { Session, YearRange } from './domain';

// The taste type test in the lab (2026-11-03): an MBTI-style four-letter code for food and for music. Light fun, not a measurement:
// the code picks a name and a sentence for the AI to read. Each axis has four questions; a tie goes to the first answer.
export type Axis = { a: string; b: string; aLabel: string; bLabel: string; aWish: string; bWish: string; tags: [string | null, string | null]; aMatch: string[]; bMatch: string[] };
export type Question = { axis: number; text: string; a: string; b: string };
/** `counts`: per axis, how many of its questions went to the first side. Absent for a result read from the registered taste, or from the older eight questions. */
export type TasteTypeResult = { code: string; date: string; source: 'quiz' | 'taste'; counts?: number[] };
const PER_AXIS = 4;

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
    { axis: 0, text: '떡볶이를 시킬 때 맵기는?', a: '제일 매운 단계에 도전', b: '순한 맛이나 1단계' },
    { axis: 1, text: '야식이 당기는 밤, 고른다면?', a: '치킨 한 마리에 밥까지', b: '요거트나 과일 한 접시' },
    { axis: 2, text: '단골집에 신메뉴가 나오면?', a: '그래도 늘 먹던 걸로', b: '일단 신메뉴부터' },
    { axis: 3, text: '갑자기 점심 약속이 취소됐다면?', a: '좋아하는 곳에 혼자 간다', b: '누구라도 불러서 같이 간다' },
    { axis: 0, text: '국물이 밍밍하다 싶을 때 손이 가는 건?', a: '고춧가루와 청양고추', b: '그대로가 좋다, 소금 조금' },
    { axis: 1, text: '뷔페에서 첫 접시는?', a: '고기와 밥부터 든든하게', b: '샐러드와 과일부터 가볍게' },
    { axis: 2, text: '친구가 처음 듣는 나라 음식을 먹자고 하면?', a: '아는 메뉴로 바꾸자고 한다', b: '좋다, 어디서 먹을까' },
    { axis: 3, text: '메뉴 두 개가 다 끌릴 때는?', a: '하나 골라 내 몫으로 끝까지', b: '둘 다 시켜 나눠 먹는다' },
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
    { axis: 0, text: '아침 출근길 첫 곡은?', a: '볼륨을 올리게 되는 강한 비트', b: '잠을 깨우지 않는 잔잔한 곡' },
    { axis: 1, text: '좋아하는 곡을 떠올리면 먼저 생각나는 건?', a: '따라 부르는 가사 한 줄', b: '귀에 남은 기타나 피아노 소리' },
    { axis: 2, text: '음악 차트를 볼 때 나는?', a: '어차피 내 인생곡은 따로 있다', b: '이번 주 1위는 들어 본다' },
    { axis: 3, text: '이어폰을 꽂는 순간은?', a: '음악을 들으려고 일부러 시간을 낸다', b: '걷거나 일할 때 자연스럽게' },
    { axis: 0, text: '비 오는 날 듣고 싶은 건?', a: '빗소리를 이기는 신나는 곡', b: '빗소리에 묻히는 조용한 곡' },
    { axis: 1, text: '표가 한 장 생긴다면?', a: '좋아하는 가수의 콘서트', b: '연주자의 리사이틀이나 재즈 클럽' },
    { axis: 2, text: '좋아하는 가수의 곡을 고른다면?', a: '초창기 대표곡', b: '가장 최근 앨범' },
    { axis: 3, text: '같은 곡이 세 번째 나오면?', a: '이번엔 베이스 소리만 따라가 본다', b: '들리는 줄도 모르고 하던 일을 한다' },
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

export type TypeProfile = { line: string; about: string; picks: string[] };
export const TYPE_PROFILES: Record<Category, Record<string, TypeProfile>> = {
  food: {
    SHTA: { line: '혼자 가도 "맵게 해 주세요"가 자연스러운 사람', about: '줄 서는 곳보다 단골집이 좋아요. 아는 얼큰함을 혼자 조용히 끝까지 즐겨요.', picks: ['얼큰 순대국', '제육덮밥', '김치찌개'] },
    SHTG: { line: '오늘 메뉴요? 제가 이미 정했습니다', about: '매운 전골 앞에 사람을 모으는 타입이에요. 아는 맛으로 실패 없는 자리를 만들어요.', picks: ['닭갈비', '부대찌개', '곱창전골'] },
    SHNA: { line: '새로 나온 매운맛은 일단 혼자 검증', about: '친구에게 권하기 전에 먼저 먹어 봐요. 든든하고 낯설수록 눈이 반짝여요.', picks: ['마라샹궈', '1인 훠궈', '빈달루 커리'] },
    SHNG: { line: '오늘 저녁, 다 같이 혀를 잃어 봅시다', about: '처음 가는 매운 집에 친구들을 데려가요. 땀 흘리며 웃는 저녁을 좋아해요.', picks: ['훠궈', '마라롱샤', '양꼬치'] },
    SLTA: { line: '한 그릇 비우고 깔끔하게 일어나는 사람', about: '칼칼한 건 좋지만 배부른 건 싫어요. 익숙한 한 그릇으로 끼니를 산뜻하게 끝내요.', picks: ['비빔국수', '김치말이국수', '쫄면'] },
    SLTG: { line: '떡볶이 앞에서는 모두가 친구', about: '가볍게 집어 먹으면서 수다 떠는 시간이 제일 맛있어요. 분식집이 곧 모임 장소예요.', picks: ['떡볶이', '튀김 모둠', '라볶이'] },
    SLNA: { line: '오늘은 처음 맡아 보는 향을 따라가요', about: '가볍고 향이 센 메뉴를 혼자 찾아다녀요. 고수는 오히려 더 넣어 달라고 해요.', picks: ['똠얌꿍', '분짜', '스리라차 포케'] },
    SLNG: { line: '각자 싸 먹는 재미까지가 메뉴', about: '새롭고 매콤한 걸 다 같이 나눠 먹는 자리를 꾸려요. 소스 종류부터 챙겨요.', picks: ['타코', '파히타', '나초 플래터'] },
    MHTA: { line: '엄마 밥 같은 집을 귀신같이 찾는 사람', about: '자극 없이 든든한 한 끼면 충분해요. 혼자서도 밥과 국을 제대로 챙겨 먹어요.', picks: ['백반', '갈비탕', '된장찌개'] },
    MHTG: { line: '일단 상부터 넉넉하게 차리고 봅니다', about: '순한 맛으로 어른부터 아이까지 챙겨요. 남아도 좋으니 모자라면 안 돼요.', picks: ['보쌈', '한정식', '삼계탕'] },
    MHNA: { line: '조용히 혼자 가서 재료 맛까지 기억하는 사람', about: '자극 대신 깊은 맛을 찾아요. 처음 보는 메뉴도 설명을 끝까지 읽고 골라요.', picks: ['버섯 리조토', '오야코동', '카오만까이'] },
    MHNG: { line: '이 집은 순서대로 드셔야 합니다', about: '좋은 곳을 찾아 사람들을 데려가요. 천천히 나오는 음식과 긴 대화를 좋아해요.', picks: ['샤브샤브 코스', '이탈리안 코스', '딤섬 한상'] },
    MLTA: { line: '국물 한 숟갈에 하루가 정리되는 사람', about: '혼자 천천히 먹는 맑은 한 그릇이 쉼이에요. 속이 편해야 기분도 편해요.', picks: ['잔치국수', '들깨죽', '맑은 미역국'] },
    MLTG: { line: '돗자리 펴면 김밥이 나오는 사람', about: '나눠 먹기 쉽고 부담 없는 메뉴를 챙겨요. 모두가 편한 메뉴를 잘 알아요.', picks: ['김밥', '유부초밥', '과일 샌드위치'] },
    MLNA: { line: '드레싱을 바꿔 보는 게 취미', about: '가볍고 새로운 조합을 혼자 시험해 봐요. 오늘의 샐러드는 어제와 달라야 해요.', picks: ['포케', '병아리콩 샐러드', '월남쌈'] },
    MLNG: { line: '다음 주 브런치 장소, 제가 찾아 뒀어요', about: '예쁘고 가벼운 메뉴로 사람들을 불러 모아요. 사진 찍을 시간까지 일정에 넣어요.', picks: ['에그 베네딕트', '프렌치토스트', '리코타 샐러드'] },
  },
  music: {
    EVRF: { line: '후렴은 같이 불러야 완성되는 사람', about: '오래된 명곡을 크게 틀고 온몸으로 들어요. 라이브 영상의 함성까지 곡의 일부예요.', picks: ['페스티벌 떼창', '90년대 록 밴드', '앙코르 명곡'] },
    EVRB: { line: '이 노래 나오면 다들 나이가 드러나죠', about: '누구나 아는 신나는 옛 노래를 틀어 분위기를 살려요. 드라이브 선곡은 늘 맡아요.', picks: ['드라이브 선곡', '2000년대 댄스곡', '노래방 인기곡'] },
    EVNF: { line: '자정 발매 알림을 켜 둔 사람', about: '새 앨범이 나오면 하던 일을 멈추고 들어요. 첫 감상평을 제일 먼저 올려요.', picks: ['발매일 첫 재생', '타이틀곡 무한 반복', '컴백 무대'] },
    EVNB: { line: '이 곡 없으면 스쿼트 못 해요', about: '요즘 신나는 노래로 몸을 움직여요. 곡이 끊기면 운동도 끊겨요.', picks: ['헬스장 플레이리스트', '러닝 피치 맞추기', '이번 주 차트'] },
    EIRF: { line: '기타 솔로에서 눈을 감는 사람', about: '오래된 라이브 연주를 찾아 들어요. 같은 곡도 연도별로 비교해 봐요.', picks: ['라이브 앨범', '기타 솔로', '전설의 공연 실황'] },
    EIRB: { line: '일할 때 어깨만 살짝 움직이는 사람', about: '신나지만 가사 없는 옛 그루브를 틀어 놓아요. 리듬이 일의 속도를 정해요.', picks: ['펑크 그루브', '재즈 퓨전', '작업실 바이닐'] },
    EINF: { line: '베이스 소리 하나로 밤을 새우는 사람', about: '새로운 소리를 찾아 끝까지 들어요. 좋은 스피커 이야기가 나오면 말이 많아져요.', picks: ['일렉트로닉 신보', '헤드폰 감상', '실험적인 사운드'] },
    EINB: { line: '비트에 맞춰 발이 먼저 나가는 사람', about: '가사 없는 빠른 비트를 틀고 움직여요. 생각을 비우는 데 이만한 게 없어요.', picks: ['러닝 비트', '하우스 믹스', '드럼앤베이스'] },
    CVRF: { line: '가사 한 줄을 일주일 동안 생각하는 사람', about: '오래된 노래의 가사를 곱씹어요. 혼자 듣다가 괜히 먹먹해지는 시간을 좋아해요.', picks: ['가사집 정독', '90년대 발라드', '혼자 듣는 밤'] },
    CVRB: { line: '사연 소개 후 나오는 그 노래가 좋은 사람', about: '잔잔한 옛 노래를 틀어 두고 하루를 마무리해요. 라디오 같은 온도를 좋아해요.', picks: ['심야 라디오', '포크 명곡', '설거지할 때 틀어 두기'] },
    CVNF: { line: '알려지기 전에 먼저 울어 본 사람', about: '요즘 나온 잔잔한 노래를 찾아 끝까지 들어요. 좋은 곡은 조용히 저장해 둬요.', picks: ['인디 신곡', '새벽 감성 앨범', '숨은 명곡 찾기'] },
    CVNB: { line: '가게 음악 뭐냐고 자주 물어보게 하는 사람', about: '잔잔한 요즘 노래로 공간의 분위기를 만들어요. 선곡에 은근히 자부심이 있어요.', picks: ['카페 선곡', '주말 오전', '요즘 어쿠스틱'] },
    CIRF: { line: '늘 앉던 자리에서 같은 앨범을 듣는 사람', about: '오래된 연주를 조용히 집중해서 들어요. 곡이 끝나도 잠깐은 말을 안 해요.', picks: ['재즈 트리오', '클래식 실황', '조명 낮춘 밤'] },
    CIRB: { line: '바늘 내리고 커피 내리는 사람', about: '오래된 연주를 틀어 두고 느리게 움직여요. 일요일 오후가 제일 잘 어울려요.', picks: ['일요일 LP', '보사노바', '커피 내리는 시간'] },
    CINF: { line: '소리와 소리 사이를 듣는 사람', about: '새로운 잔잔한 소리를 집중해서 들어요. 곡이 어디서 끝났는지 모를 때가 제일 좋아요.', picks: ['앰비언트 신보', '현대 피아노', '헤드폰 명상'] },
    CINB: { line: '이 곡 틀면 세 시간이 사라지는 사람', about: '가사 없는 잔잔한 곡을 작업 배경으로 깔아요. 음악이 있다는 걸 잊을 때가 성공이에요.', picks: ['로파이 스터디', '피아노 연주곡', '마감 전 세 시간'] },
  },
};

/** Answers of each axis that went to its first side, in AXES order. */
export function countsFromAnswers(category: Category, answers: ('a' | 'b')[]): number[] {
  return AXES[category].map((_, n) => QUESTIONS[category].filter((q, i) => q.axis === n && answers[i] === 'a').length);
}
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
export const typeProfile = (category: Category, code: string): TypeProfile | undefined => TYPE_PROFILES[category][code];
export const sides = (category: Category, code: string) => AXES[category].map((axis, n) => code[n] === axis.a ? { letter: axis.a, label: axis.aLabel, wish: axis.aWish, tag: axis.tags[0] } : { letter: axis.b, label: axis.bLabel, wish: axis.bWish, tag: axis.tags[1] });

/** How far each axis leans, for the bars. Empty without answer counts: a result read from tags has no proportion to show. */
export function axisLeans(category: Category, counts?: number[]) {
  if (!counts) return [];
  return AXES[category].map((axis, n) => ({ aLabel: axis.aLabel, bLabel: axis.bLabel, aPercent: Math.round(counts[n] / PER_AXIS * 100) }));
}

/** A request in the type's words: the sentence is for the AI, the tags and years are the checkable part. An axis answered half and half asks for neither side. */
export function requestForType(category: Category, code: string, now = new Date().getFullYear(), counts?: number[]): Pick<Session, 'raw' | 'conditions' | 'years'> {
  const decided = (n: number) => !counts || counts[n] !== PER_AXIS / 2;
  const parts = sides(category, code).filter((_, n) => decided(n));
  const years: YearRange | undefined = category !== 'music' || !decided(2) ? undefined : code[2] === 'R' ? { to: now - 10 } : { from: now - 2 };
  return { raw: parts.map(p => p.wish).join(', ').slice(0, 280) + ' 위주로 추천해줘', conditions: { tags: parts.flatMap(p => p.tag ? [p.tag] : []), excluded: [] }, ...(years ? { years } : {}) };
}

// Who gets along: the same taste on the first two axes with the other two filling each other in, and the reverse.
const flip = (category: Category, code: string, axes: number[]) => code.split('').map((letter, n) => { const axis = AXES[category][n]; return axes.includes(n) ? (letter === axis.a ? axis.b : axis.a) : letter; }).join('');
const WHY: Record<Category, { best: string; worst: string }> = {
  food: { best: '입맛은 같은데 메뉴 고르는 방식은 서로 채워 줘요.', worst: '먹는 방식은 통하는데 메뉴판 앞에서 늘 갈려요.' },
  music: { best: '듣고 싶은 분위기는 같은데 듣는 방식은 서로 넓혀 줘요.', worst: '듣는 습관은 비슷한데 플레이리스트 주도권을 두고 다퉈요.' },
};
export function relatedTypes(category: Category, code: string) {
  const best = flip(category, code, [2, 3]), worst = flip(category, code, [0, 1]);
  return { best: { code: best, name: typeName(category, best), why: WHY[category].best }, worst: { code: worst, name: typeName(category, worst), why: WHY[category].worst } };
}

// A link carries only the codes, the answer counts and the name the person set: "?t=f-SHTA-3432.m-CIRF-1133&n=이름#/type".
export type SharedType = { code: string; counts?: number[] };
export type SharedTypes = { name: string; types: Partial<Record<Category, SharedType>> };
const NAME_LIMIT = 12;
const LETTER: Record<string, Category> = { f: 'food', m: 'music' };
export function shareSearch(results: Partial<Record<Category, Pick<TasteTypeResult, 'code' | 'counts'>>>, name = ''): string {
  const part = (key: string, c: Category) => { const r = results[c]; return r ? [`${key}-${r.code}${r.counts ? `-${r.counts.join('')}` : ''}`] : []; };
  const t = [...part('f', 'food'), ...part('m', 'music')].join('.');
  const label = name.trim().slice(0, NAME_LIMIT);
  return `?t=${t}${label ? `&n=${encodeURIComponent(label)}` : ''}`;
}
/** Null unless the link is exactly what shareSearch writes: anything else in the address is not a result to show. */
export function parseShared(search: string): SharedTypes | null {
  const params = new URLSearchParams(search), t = params.get('t');
  if (!t) return null;
  const types: SharedTypes['types'] = {};
  for (const part of t.split('.')) {
    const [key, code, digits] = part.split('-'), category = LETTER[key];
    if (!category || !TYPE_NAMES[category][code] || types[category]) return null;
    let counts: number[] | undefined;
    if (digits !== undefined) {
      counts = digits.split('').map(Number);
      const agrees = counts.length === PER_AXIS && counts.every((n, i) => Number.isInteger(n) && n >= 0 && n <= PER_AXIS && (n === PER_AXIS / 2 || (n > PER_AXIS / 2) === (code[i] === AXES[category][i].a)));
      if (!agrees) return null;
    }
    types[category] = { code, ...(counts ? { counts } : {}) };
  }
  // eslint-disable-next-line no-control-regex
  return { name: (params.get('n') || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NAME_LIMIT), types };
}

const share = (category: Category, t: SharedType) => AXES[category].map((axis, n) => t.counts ? t.counts[n] / PER_AXIS : t.code[n] === axis.a ? 1 : 0);
/** For fun: the floor keeps two friends from reading 0%. Near answers score near each other; a shared letter is what the lists name. */
export function compareTypes(category: Category, mine: SharedType, theirs: SharedType) {
  const a = share(category, mine), b = share(category, theirs);
  const closeness = 1 - a.reduce((sum, v, n) => sum + Math.abs(v - b[n]), 0) / a.length;
  const percent = Math.round(45 + 55 * closeness);
  const mySides = sides(category, mine.code), theirSides = sides(category, theirs.code);
  return { percent, verdict: percent >= 85 ? '찰떡이에요' : percent >= 65 ? '잘 맞는 편이에요' : '티격태격하는 사이예요',
    same: mySides.flatMap((s, n) => s.letter === theirSides[n].letter ? [s.label] : []),
    different: mySides.flatMap((s, n) => s.letter !== theirSides[n].letter ? [{ mine: s.label, theirs: theirSides[n].label }] : []) };
}
/** Something for the two of them: items carrying what both lean to. */
export function togetherItems(category: Category, mine: SharedType, theirs: SharedType, items: Item[], count = 3): Item[] {
  const wanted = AXES[category].flatMap((axis, n) => mine.code[n] !== theirs.code[n] ? [] : mine.code[n] === axis.a ? axis.aMatch : axis.bMatch);
  const score = (i: Item) => i.tags.filter(t => wanted.includes(t)).length;
  return items.filter(i => i.category === category && score(i) > 0).sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id)).slice(0, count);
}
