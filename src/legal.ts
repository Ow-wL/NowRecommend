// Terms of service and privacy policy (2026-11-17), as data: the pages render these sections, the sign-up form names
// LEGAL_VERSION as what was agreed to, and the server stores that version with the account.
//
// What is written here follows what the code does (what is stored where, what leaves the browser, who receives it); when
// the code changes, this changes with it and LEGAL_VERSION moves. It is not legal advice: have it reviewed before launch.
import shared from '../shared/legal.json' with { type: 'json' };

/** The version in force. Shared with the server (shared/legal.json), which accepts a sign-up only for this version. */
export const LEGAL_VERSION: string = shared.version;
/** The AI provider's terms allow its API only in services for people of 18 and over, so that is the service's age. */
export const MIN_AGE: number = shared.minAge;
/** Where this browser remembers that the person said they are of age (asked once, before the AI is used). */
export const ADULT_KEY = 'nowrecommend-adult-v1';
export function adultConfirmed(): boolean { try { return localStorage.getItem(ADULT_KEY) === LEGAL_VERSION; } catch { return false; } }
export function confirmAdult(): void { try { localStorage.setItem(ADULT_KEY, LEGAL_VERSION); } catch { /* asked again next time */ } }
/** Who runs the service and where to write, from the build (VITE_OPERATOR_NAME, VITE_CONTACT_EMAIL). Both must be set
 * before a public launch; while they are missing the pages say so instead of showing an empty line. */
export const OPERATOR = (import.meta.env?.VITE_OPERATOR_NAME ?? '').trim();
export const CONTACT_EMAIL = (import.meta.env?.VITE_CONTACT_EMAIL ?? '').trim();
export const operatorKnown = (operator = OPERATOR, contact = CONTACT_EMAIL) => operator !== '' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact);

export type LegalKind = 'terms' | 'privacy';
/** A paragraph, or a list of points. */
export type LegalBlock = string | string[];
export type LegalSection = { title: string; blocks: LegalBlock[] };
export type LegalInfo = { operator: string; contact: string; weather: boolean; previews: boolean };
export const legalTitle: Record<LegalKind, string> = { terms: '이용약관', privacy: '개인정보 처리방침' };

const who = (info: LegalInfo) => info.operator || '운영자';
const where = (info: LegalInfo) => info.contact || '(문의 주소 준비 중)';

export function termsSections(info: LegalInfo): LegalSection[] {
  return [
    { title: '1. 서비스', blocks: [
      `'지금 추천'(이하 서비스)은 평소 취향과 지금의 상황을 함께 반영해 음식 메뉴와 음악을 추천합니다. ${who(info)}(이하 운영자)가 제공합니다.`,
      '서비스는 메뉴와 곡을 추천할 뿐, 음식의 주문·배달·결제나 음원의 판매·전곡 재생을 하지 않습니다. 곡의 30초 미리듣기는 Apple이 제공하는 것을 그대로 들려줍니다. 음식점, 지도, 레시피, 음악 서비스로 가는 링크는 각 서비스의 약관을 따릅니다.',
    ] },
    { title: '2. 이용 대상과 계정', blocks: [
      `서비스는 만 ${MIN_AGE}세 이상만 이용할 수 있습니다.`,
      '계정 없이도 이용할 수 있습니다. 이 경우 취향과 기록은 이용 중인 브라우저에만 저장됩니다.',
      '계정을 만들면 취향·즐겨찾기·기록을 다른 기기에서도 이어 쓸 수 있습니다. 계정은 본인의 이메일 주소로 만들고, 비밀번호는 다른 사람에게 알려주지 않습니다.',
      '계정은 설정에서 언제든 삭제할 수 있습니다. 삭제하면 서버에 저장된 계정 정보와 동기화 데이터가 지워집니다.',
    ] },
    { title: '3. 추천 결과에 대해', blocks: [
      '추천은 등록된 정보와 인공지능(AI)의 판단으로 만들어집니다. AI는 실제로 없는 메뉴나 곡을 말하거나, 사실과 다른 설명을 할 수 있습니다.',
      '재료와 제외 조건은 등록 정보와 AI가 추정한 재료를 기준으로 합니다. 실제 판매처의 재료, 조리법, 알레르기 유발 성분과 다를 수 있으므로 알레르기나 식이 제한이 있다면 주문 전에 판매처에 직접 확인해야 합니다. 서비스는 알레르기 안전을 보장하지 않습니다.',
      '추천은 참고 정보이며 의학·영양 상담이 아닙니다.',
    ] },
    { title: '4. 이용 한도', blocks: [
      '서비스의 안정적인 운영을 위해 이용 횟수에 한도가 있습니다. 하루 한도를 넘으면 AI 추천 대신 등록된 목록에서 추천하고, 짧은 시간에 요청이 너무 많으면 잠시 뒤에 다시 시도하라고 안내합니다.',
    ] },
    { title: '5. 하면 안 되는 일', blocks: [[
      '다른 사람의 계정을 쓰거나 다른 사람의 정보를 입력하는 일',
      '자동화된 수단으로 과도하게 요청하거나 한도를 우회하는 일',
      '서비스의 보안을 시험하거나 정상 운영을 방해하는 일',
      '입력란에 타인의 개인정보, 민감한 정보, 법령에 어긋나는 내용을 적는 일',
    ], '위와 같은 이용이 확인되면 이용을 제한하거나 계정을 삭제할 수 있습니다.'] },
    { title: '6. 콘텐츠와 출처', blocks: [
      '음악의 미리듣기와 앨범 이미지는 Apple(iTunes)이 제공하는 것이며, 각 곡의 권리는 권리자에게 있습니다. 음식 사진의 출처는 각 항목의 상세 화면에 표시합니다.',
      '이용자가 적은 취향, 메모, 평가는 추천을 만드는 데에만 씁니다.',
    ] },
    { title: '7. 서비스의 변경과 중단', blocks: [
      '운영자는 기능을 바꾸거나 서비스를 중단할 수 있습니다. 이용자에게 불리한 변경이나 서비스 종료는 미리 서비스 화면에 알립니다.',
      '점검, 장애, 외부 서비스(AI, 음악 정보 제공처 등)의 사정으로 일부 기능이 일시적으로 동작하지 않을 수 있습니다.',
    ] },
    { title: '8. 책임의 한계', blocks: [
      '서비스는 무료로 제공되며, 운영자는 추천 결과의 정확성이나 특정 목적에의 적합성을 보증하지 않습니다. 운영자의 고의 또는 중대한 과실로 생긴 손해는 관련 법령에 따라 책임을 집니다.',
      '브라우저에만 저장된 데이터는 브라우저의 저장소를 지우면 함께 사라집니다. 설정의 백업 기능으로 내보낼 수 있습니다.',
    ] },
    { title: '9. 약관의 변경과 문의', blocks: [
      '약관을 바꿀 때는 시행일과 바뀐 내용을 서비스 화면에 미리 알립니다.',
      `이 약관은 대한민국 법을 따릅니다. 문의: ${where(info)}`,
    ] },
  ];
}

export function privacySections(info: LegalInfo): LegalSection[] {
  const outside: string[] = [
    'Google LLC (Gemini API, 미국 등): 추천과 문장 해석을 위해 입력한 문장, 선택한 조건, 취향으로 등록하거나 싫다고 표시한 메뉴·곡의 이름, 직접 적은 메모, 이번에 이미 본 추천의 이름을 보냅니다. 이메일·이름 같은 계정 정보는 보내지 않지만, 입력란에 적은 내용은 그대로 전달되므로 개인정보를 적지 말아 주세요. 추천이나 문장 해석을 요청할 때 전송되며, 유료 등급 약관에 따라 Google의 모델 학습에는 쓰이지 않습니다.',
    'Google Cloud (대한민국 서울 리전): 서버와 데이터베이스를 운영합니다. 계정 정보와 동기화 데이터가 여기에 저장됩니다.',
    'Apple Inc. (iTunes, 미국 등): 추천된 곡이 실제로 있는지 확인하고 미리듣기·앨범 이미지를 불러오기 위해, 브라우저와 서버가 곡 제목과 가수 이름으로 검색을 요청합니다. 브라우저가 직접 요청할 때 접속 주소(IP)가 전달됩니다.',
    ...(info.weather ? ['Open-Meteo (독일 등): "지금 날씨 반영"을 누른 경우에만, 약 1km 단위로 줄인 위치 좌표를 보내 현재 날씨를 받습니다. 좌표는 서버에 저장하지 않습니다.'] : []),
    'GitHub, jsDelivr, Wikimedia 등 화면과 글꼴·이미지를 전달하는 서비스: 페이지와 이미지를 불러올 때 접속 주소(IP)가 전달됩니다.',
    // The mail provider by name (server SMTP_HOST): what it receives, where it keeps it and for how long (resend.com/legal/dpa,
    // resend.com/docs/knowledge-base/account-quotas-and-limits, read 2026-11-17). Change this line with the provider.
    'Resend (Plus Five Five, Inc., 미국): 비밀번호 재설정을 요청한 경우에만, 가입한 이메일 주소로 이름과 재설정 링크가 담긴 안내 메일을 이 서비스를 통해 보냅니다. 이메일 주소, 메일 내용, 발송 기록이 미국에서 처리·저장되며 Resend가 30일 동안 보관한 뒤 지웁니다. 재설정을 요청하지 않으면 전송되지 않습니다. Resend의 개인정보 문의: privacy@resend.com',
    '지도·레시피·동영상·음악 서비스로 가는 링크: 누르면 그 서비스가 열리며 메뉴나 곡의 이름이 검색어로 전달됩니다. 누르지 않으면 전달되지 않습니다.',
  ];
  return [
    { title: '1. 수집하는 정보와 목적', blocks: [
      '계정을 만들지 않으면 이름이나 이메일을 받지 않습니다. 취향, 즐겨찾기, 추천 기록은 이용 중인 브라우저의 저장소(localStorage)에만 남고, 서버에는 아래의 접속 기록만 남습니다.',
      [
        '계정 정보(가입 시): 이메일 주소, 이름(별명), 암호화해 저장하는 비밀번호, 약관 동의 일시와 버전. 로그인과 계정 식별, 비밀번호 재설정 안내에 씁니다.',
        '동기화 데이터(로그인 시): 취향으로 등록한 항목과 메모, 즐겨찾기, 추천 기록(입력한 문장, 조건, 결과, 선택과 평가), 화면 설정. 다른 기기에서 이어 쓰기 위해 계정에 저장합니다.',
        '추천 요청 내용: 입력한 문장과 조건은 추천을 만드는 데 쓰고, 같은 문장을 다시 물을 때 빨리 답하도록 서버의 메모리에 잠시 둡니다(서버가 다시 시작되면 사라집니다). 데이터베이스에는 조건과 추천 결과만 통계 목적으로 기록하며, 이 기록은 계정이나 이용자와 연결하지 않고 입력한 문장 원문도 남기지 않습니다. AI가 추천한 메뉴와 곡의 이름은 다음 추천에 쓰기 위해 목록에 저장합니다.',
        '오류 신고: 신고한 항목, 종류, 적은 내용. 로그인 상태였다면 신고한 계정도 함께 기록합니다. 정보 오류를 고치는 데 씁니다.',
        '접속 기록: 접속 주소(IP), 요청 시각과 경로. 장애 대응과 부정 이용 방지에 씁니다. 하루 이용 한도와 비밀번호를 틀린 횟수는 접속 주소나 이메일 주소를 복원할 수 없게 변환한 값으로 셉니다.',
        '오류 기록: 화면에 오류가 나면 오류 메시지, 오류가 난 코드의 위치, 화면의 종류, 앱 버전을 서버에 보냅니다. 이메일 주소나 로그인 토큰처럼 보이는 부분은 지우고 보내며, 계정 정보는 담지 않습니다. 다만 오류 메시지에 화면에 있던 내용의 일부가 섞일 수 있습니다. 접속 기록과 같은 기간 보관합니다.',
      ],
      '주민등록번호, 결제 정보, 정확한 위치, 음성은 수집하지 않습니다. "말로 입력"은 브라우저의 음성 인식 기능을 쓰며, 이때 음성이 브라우저 제공사의 음성 인식 서비스로 전송될 수 있습니다. 서비스는 인식된 글자만 받습니다.',
    ] },
    { title: '2. 보관 기간', blocks: [[
      '계정 정보와 동기화 데이터: 계정을 삭제할 때까지. 삭제하면 바로 지우며, 데이터베이스 백업에는 최대 7일 더 남았다가 사라집니다.',
      '오류 신고: 서비스를 운영하는 동안. 신고에는 개인을 알아볼 수 있는 내용을 적지 말아 주세요. 계정을 삭제하면 신고와 계정의 연결을 끊습니다.',
      '접속 기록: 30일. 하루 이용 한도 기록: 7일.',
      '추천 통계 기록과 AI가 추천한 메뉴·곡의 이름: 서비스를 운영하는 동안. 이용자와 연결되지 않는 기록입니다.',
      '브라우저에 저장된 데이터: 이용자가 지울 때까지. 설정 > 데이터 관리의 "이 브라우저의 데이터 모두 초기화"는 취향·기록과 그 보관본, 미리듣기·곡 확인 같은 임시 저장까지 이 브라우저에서 모두 지웁니다.',
    ]] },
    { title: '3. 외부에 맡기거나 전달하는 정보', blocks: [
      '서비스는 이용자의 정보를 판매하지 않으며, 아래 경우에만 서비스 제공에 필요한 범위에서 외부 서비스가 정보를 처리합니다. 일부는 국외에서 처리됩니다.',
      outside,
      '법령에 따른 요청이 있는 경우를 제외하고, 위에 적지 않은 곳에는 제공하지 않습니다.',
    ] },
    { title: '4. 이용자의 권리', blocks: [[
      '열람·수정: 설정에서 화면에 보이는 이름과 비밀번호를 바꾸고, "내 취향"과 "추천 기록"에서 저장된 내용을 보고 고칠 수 있습니다. 가입할 때 적은 이름과 이메일의 수정은 아래 문의로 요청해 주세요.',
      '삭제: 설정에서 계정과 계정 데이터를 삭제할 수 있습니다. 브라우저의 데이터는 "데이터 관리"에서 지웁니다.',
      '내보내기: "데이터 관리"의 백업으로 취향과 기록을 파일로 받을 수 있습니다.',
      `그 밖의 요청(열람, 정정, 삭제, 처리 정지)과 문의는 ${where(info)} 로 보내주세요. 확인 후 지체 없이 처리합니다.`,
    ]] },
    { title: '5. 쿠키와 브라우저 저장소', blocks: [
      '서비스는 광고·추적용 쿠키를 쓰지 않습니다. 취향, 기록, 로그인 상태, 화면 설정을 브라우저 저장소에 보관하며, 이는 서비스 동작에 필요한 저장입니다.',
    ] },
    { title: '6. 안전하게 지키기 위한 조치', blocks: [[
      '비밀번호는 복원할 수 없는 방식(PBKDF2)으로 변환해 저장합니다.',
      '브라우저와 서버 사이의 통신은 암호화(HTTPS)합니다.',
      '비밀번호를 바꾸거나 "모든 기기에서 로그아웃"을 하면 이전 로그인은 모두 끝납니다.',
      '서버의 비밀 값은 별도의 비밀 저장소에 두고, 데이터베이스는 매일 백업합니다.',
    ]] },
    { title: `7. 만 ${MIN_AGE}세 미만`, blocks: [
      `서비스는 만 ${MIN_AGE}세 이상을 대상으로 하며, 그 미만인 사람의 정보를 알면서 수집하지 않습니다. 해당하는 계정을 확인하면 삭제합니다.`,
    ] },
    { title: '8. 책임자와 문의', blocks: [
      `개인정보 보호책임자: ${who(info)} · 문의: ${where(info)}`,
      '개인정보 침해에 관한 상담은 개인정보침해신고센터(privacy.kisa.or.kr, 국번 없이 118), 개인정보분쟁조정위원회(www.kopico.go.kr, 1833-6972)에 할 수 있습니다.',
    ] },
    { title: '9. 방침의 변경', blocks: [
      '이 방침을 바꿀 때는 시행 7일 전(이용자에게 중요한 변경은 30일 전)부터 서비스 화면에 알립니다.',
    ] },
  ];
}
