// Terms of service and privacy policy (2026-11-17), as data: the pages render these sections, the sign-up form names
// LEGAL_VERSION as what was agreed to, and the server stores that version with the account.
//
// What is written here follows what the code does (what is stored where, what leaves the browser, who receives it); when
// the code changes, this changes with it and LEGAL_VERSION moves. It is not legal advice: have it reviewed before launch.
import shared from '../shared/legal.json' with { type: 'json' };

/** The version in force. Shared with the server (shared/legal.json), which accepts a sign-up only for this version. */
export const LEGAL_VERSION: string = shared.version;
/** Earlier versions, newest first, each kept as shown on the site in public/legal/<version>/ (scripts/legal-snapshot.cjs,
 * run on the live site before a new version is deployed). */
export const PREVIOUS_VERSIONS: string[] = ['2026-11-18.2', '2026-11-18', '2026-11-17'];
/** A version as people read it: the date it took effect, and which of that day's versions it is when there were more
 * (2026-11-18.2: a second version the same day, in force from its deploy). */
export const versionLabel = (version: string): string => version.replace(/^(\d{4}-\d{2}-\d{2})\.(\d+)$/, (_, day: string, n: string) => `${day} (그날 ${n === '2' ? '두' : n} 번째 판)`);
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
/** A paragraph, or a list of points. `**…**` marks what the terms must make plain (shown in bold, Legal.tsx). */
export type LegalBlock = string | string[];
export type LegalSection = { title: string; blocks: LegalBlock[] };
/** `player`: Apple Music's embed player is offered in the song details (src/features.ts fullPlayOn). */
export type LegalInfo = { operator: string; contact: string; weather: boolean; previews: boolean; player?: boolean;
  /** `youtube`: YouTube's player is offered in the song details (src/features.ts youtubeOn, with a server). */
  youtube?: boolean };
export const legalTitle: Record<LegalKind, string> = { terms: '이용약관', privacy: '개인정보 처리방침' };

const who = (info: LegalInfo) => info.operator || '운영자';
const where = (info: LegalInfo) => info.contact || '(문의 주소 준비 중)';

export function termsSections(info: LegalInfo): LegalSection[] {
  return [
    { title: '1. 서비스', blocks: [
      `'지금 추천'(이하 서비스)은 평소 취향과 지금의 상황을 함께 반영해 음식 메뉴와 음악을 추천합니다. ${who(info)}(이하 운영자)가 제공합니다.`,
      '**추천은 이용자가 입력한 문장과 조건, 등록한 취향을 외부 AI 서비스(Google Gemini)로 보내 만듭니다.** 계정이 있으면 취향과 기록을 서버에 보관해 다른 기기와 맞추고, 가입할 때와 비밀번호를 잊었을 때 가입한 이메일로 확인·재설정 안내를 보냅니다. 무엇이 어디로 가는지는 개인정보 처리방침에 적혀 있습니다.',
      info.player
        ? '서비스는 메뉴와 곡을 추천할 뿐, 음식의 주문·배달·결제나 음원의 판매·전송을 하지 않습니다. 곡의 30초 미리듣기는 Apple이 제공하는 것을 그대로 들려줍니다. 곡 상세에서 여는 Apple Music 플레이어는 Apple이 제공하는 화면이며, 전곡을 들을 수 있는지는 Apple Music 구독과 로그인, 그 곡의 제공 여부에 따릅니다. 음식점, 지도, 레시피, 음악 서비스로 가는 링크와 Apple Music 플레이어는 각 서비스의 약관을 따릅니다.'
        : '서비스는 메뉴와 곡을 추천할 뿐, 음식의 주문·배달·결제나 음원의 판매·전곡 재생을 하지 않습니다. 곡의 30초 미리듣기는 Apple이 제공하는 것을 그대로 들려줍니다. 음식점, 지도, 레시피, 음악 서비스로 가는 링크는 각 서비스의 약관을 따릅니다.',
      ...(info.youtube ? ['곡 상세의 "YouTube로 듣기"는 YouTube API 서비스로 찾은 영상을 YouTube의 플레이어로 재생합니다. **이 기능을 이용하면 YouTube 이용약관(https://www.youtube.com/t/terms)에 동의하는 것으로 보며,** 영상과 플레이어에는 YouTube 이용약관이 적용됩니다. 찾은 영상은 다른 버전이거나 공식 영상이 아닐 수 있습니다.'] : [])
    ] },
    { title: '2. 이용 대상과 계정', blocks: [
      `서비스는 만 ${MIN_AGE}세 이상만 이용할 수 있습니다.`,
      '계정 없이도 이용할 수 있습니다. 이 경우 취향과 기록은 이용 중인 브라우저에만 저장됩니다.',
      '계정을 만들면 취향·즐겨찾기·기록을 다른 기기에서도 이어 쓸 수 있습니다. 계정은 본인의 이메일 주소로 만들고, 비밀번호는 다른 사람에게 알려주지 않습니다.',
      '**가입은 가입한 이메일로 보내는 확인 메일의 버튼을 눌러야 끝나며, 그 전에는 로그인할 수 없습니다.** 확인하지 않은 가입 신청은 7일이 지나면 삭제됩니다. 이메일 확인 전에 만든 계정도 다음 로그인 때 같은 확인을 거칩니다.',
      '계정은 설정에서 언제든 삭제할 수 있습니다. 삭제하면 서버에 저장된 계정 정보와 동기화 데이터가 지워집니다.',
    ] },
    { title: '3. 추천 결과에 대해', blocks: [
      '추천은 등록된 정보와 인공지능(AI)의 판단으로 만들어집니다. **AI는 실제로 없는 메뉴나 곡을 말하거나, 사실과 다른 설명을 할 수 있습니다.**',
      '재료와 제외 조건은 등록 정보와 AI가 추정한 재료를 기준으로 합니다. 실제 판매처의 재료, 조리법, 알레르기 유발 성분과 다를 수 있으므로 알레르기나 식이 제한이 있다면 주문 전에 판매처에 직접 확인해야 합니다. **서비스는 알레르기 안전을 보장하지 않습니다.**',
      '**추천은 참고 정보이며 의학·영양 상담이 아닙니다.**',
    ] },
    { title: '4. 이용 한도', blocks: [
      '서비스의 안정적인 운영을 위해 이용 횟수에 한도가 있습니다. 하루 한도를 넘으면 AI 추천 대신 등록된 목록에서 추천하고, 짧은 시간에 요청이 너무 많으면 잠시 뒤에 다시 시도하라고 안내합니다.',
    ] },
    { title: '5. 하면 안 되는 일', blocks: [[
      '다른 사람의 계정을 쓰거나 다른 사람의 정보를 입력하는 일',
      '자동화된 수단으로 과도하게 요청하거나 한도를 우회하는 일',
      '서비스의 보안을 시험하거나 정상 운영을 방해하는 일',
      '입력란에 타인의 개인정보, 민감한 정보, 법령에 어긋나는 내용을 적는 일',
    ], '**위와 같은 이용이 확인되면 이용을 제한하거나 계정을 삭제할 수 있습니다.** 계정을 제한하거나 삭제할 때는 가입한 이메일로 이유를 미리 알리며, 보안이나 다른 이용자의 보호를 위해 급히 막아야 하는 경우에는 조치한 뒤 바로 알립니다. 계정 없이 이용하는 경우에는 요청을 막는 화면의 안내로 알립니다. 조치에 이의가 있으면 아래 문의 주소로 알려 주세요. 확인해서 답합니다.'] },
    { title: '6. 콘텐츠와 출처', blocks: [
      '음악의 미리듣기와 앨범 이미지는 Apple(iTunes)이 제공하는 것이며, 각 곡의 권리는 권리자에게 있습니다. 음식 사진의 출처는 각 항목의 상세 화면에 표시합니다.',
      '이용자가 적은 취향, 메모, 평가는 추천을 만드는 데에만 씁니다. "의견 보내기"로 보낸 의견은 답장과 서비스 개선에 씁니다.',
    ] },
    { title: '7. 서비스의 변경과 중단', blocks: [
      '운영자는 기능 개선, 외부 서비스(AI, 음악 정보 제공처 등)의 조건이나 비용의 변화, 법령, 보안상의 이유가 있을 때 기능을 바꾸거나 서비스를 종료할 수 있습니다. **이용자에게 불리한 변경과 서비스 종료는 30일 전부터 서비스 화면에 알립니다.** 장애나 보안 문제처럼 급히 조치해야 하는 경우에는 조치한 뒤 바로 알립니다.',
      '서비스를 종료할 때는 종료일까지 설정의 백업 기능으로 취향과 기록을 내려받을 수 있으며, 종료한 뒤 서버에 저장된 계정 정보와 동기화 데이터를 지웁니다.',
      '점검, 장애, 외부 서비스(AI, 음악 정보 제공처 등)의 사정으로 일부 기능이 일시적으로 동작하지 않을 수 있습니다.',
    ] },
    { title: '8. 책임의 한계', blocks: [
      '서비스는 무료로 제공되며 추천은 참고 정보입니다. **운영자는 추천 결과가 정확하다거나 특정한 목적에 맞는다고 보증하지 않습니다.**',
      '운영자에게 책임이 있는 사유로 이용자에게 손해가 생기면 운영자는 관련 법령에 따라 책임을 집니다. 개인정보에 관한 책임은 개인정보 보호법이 정한 바에 따릅니다.',
      '**브라우저에만 저장된 데이터는 브라우저의 저장소를 지우면 함께 사라집니다.** 설정의 백업 기능으로 내보낼 수 있습니다.',
    ] },
    { title: '9. 약관의 변경, 분쟁, 문의', blocks: [
      '약관을 바꿀 때는 시행일, 바뀐 내용과 이유를 시행일 7일 전부터 서비스 화면에 알립니다. 이용자에게 불리하거나 중요한 변경은 30일 전부터 알립니다.',
      '바뀐 약관에 동의하지 않으면 이용을 멈추고 설정에서 계정을 삭제할 수 있습니다.',
      `이 약관은 대한민국 법을 따르며, 서비스와 관련한 분쟁의 관할 법원은 민사소송법에 따라 정합니다. 문의: ${where(info)}`,
    ] },
  ];
}

// The policy follows the items the law asks for (개인정보 보호법 제30조 제1항, 시행령 제31조) in the order of the
// regulator's guide (개인정보 처리방침 작성지침, 2026. 4.). The articles and the other companies' terms it leans on were
// read on 2026-11-17: 제15조 제1항 (grounds), 제28조의8 (transfer abroad: what must be told), 제26조 (entrusting), 제35조~제38조
// and 시행령 제41조~제44조 (answer within 10 days), Gemini API terms and abuse monitoring (55 days, paid services are not
// used to improve products), cloud.google.com/terms/google-entity (the contracting entity for Korea), Cloud Logging
// quotas (30 days by default, 400 for admin activity), open-meteo.com/en/terms (logs 90 days), resend.com/legal/dpa.
// A lawyer has not read it. When a provider or what is sent changes, its line here changes with it.
export function privacySections(info: LegalInfo): LegalSection[] {
  const entrusted: string[] = [
    'Google Cloud (계약 상대방 Google Cloud Korea LLC, 저장 위치 대한민국 서울): 서버와 데이터베이스의 운영을 맡깁니다. 계정 정보, 동기화 데이터, 오류 신고, 의견, 접속 기록과 오류 기록이 여기에 저장됩니다. 보관 기간은 위 2항과 같습니다. 문의: support.google.com/cloud/contact/dpo',
    'Google LLC (Gemini API, 미국과 그 밖에 Google이 데이터 센터를 둔 국가): 추천을 만들고 입력한 문장을 해석하는 일을 맡깁니다. 이전 항목: 입력한 문장, 선택한 조건, 취향으로 등록하거나 싫다고 표시한 메뉴·곡의 이름, 직접 적은 메모, 이번에 이미 본 추천의 이름. 이메일·이름 같은 계정 정보는 보내지 않지만, 입력란에 적은 내용은 그대로 전달되므로 개인정보를 적지 말아 주세요. 이전 시기와 방법: 추천이나 문장 해석을 요청할 때마다 암호화된 통신(TLS)으로 전송합니다. 보유 기간: Google이 오용을 막기 위해 55일 동안 보관합니다. 유료 등급 약관에 따라 Google의 모델 학습이나 제품 개선에는 쓰이지 않습니다. 문의: googlekrsupport@google.com',
    // The mail provider by name (server SMTP_HOST). Change this line with the provider.
    'Resend (Plus Five Five, Inc., 미국. 발송 서버는 일본): 가입 확인 메일과 비밀번호 재설정 안내 메일의 발송을 맡깁니다. 이전 항목: 가입한 이메일 주소, 이름, 확인·재설정 링크가 담긴 메일 내용, 발송 기록. 이전 시기와 방법: 가입할 때, 이메일을 확인하지 않은 계정으로 로그인할 때, 비밀번호 재설정을 요청한 때에 암호화된 통신(TLS)으로 전송합니다. 보유 기간: Resend가 30일 동안 보관한 뒤 지웁니다. 문의: privacy@resend.com',
  ];
  const direct: string[] = [
    'Apple Inc. (iTunes, 미국 등): 추천된 곡이 실제로 있는지 확인하고 미리듣기·앨범 이미지를 불러오기 위해 곡 제목과 가수 이름으로 검색을 요청합니다. 서버가 요청할 때는 이용자의 계정 정보나 접속 주소 없이 곡 제목, 가수 이름, 곡 번호만으로 찾고, 브라우저가 직접 요청할 때는 접속 주소(IP)도 함께 전달됩니다. 문의: apple.com/kr/privacy/contact',
    // What Apple says its embedded player collects (apple.com/legal/privacy/data/ko/apple-music-web, read 2026-11-17).
    ...(info.player ? ['Apple Inc. (Apple Music 플레이어, 미국 등): 곡 상세에서 "Apple Music 플레이어 열기"를 누른 경우에만 Apple의 플레이어를 화면 안에 불러옵니다. 이때부터 Apple은 플레이어가 놓인 사이트의 주소, 브라우저와 기기 정보, 접속 주소(IP), 재생한 곡 같은 이용 내역을 하루 동안 유지되는 식별자와 함께 수집하고, 플레이어에서 Apple 계정으로 로그인하면 이용 내역이 그 계정과 연결됩니다. Apple은 자체 쿠키와 저장소를 쓰며 이 정보를 최대 2년 보관한다고 밝히고 있습니다(https://www.apple.com/legal/privacy/data/ko/apple-music-web/). 로그인은 Apple의 창에서 이뤄지고, 지금 추천은 Apple 계정의 아이디·비밀번호·로그인 정보나 구독 여부를 받지 않습니다. 지금 추천에서 로그아웃하거나 데이터를 지워도 Apple 쪽의 로그인과 기록은 그대로이므로, 필요하면 플레이어나 Apple의 설정에서 로그아웃해 주세요. 버튼을 누르지 않으면 플레이어를 불러오지 않습니다.'] : []),
    ...(info.weather ? ['Open-Meteo (OpenMeteo GmbH, 스위스. 서버는 유럽과 북미): "지금 날씨 반영"을 누른 경우에만, 약 1km 단위로 줄인 위치 좌표를 보내 현재 날씨를 받습니다. 좌표는 서비스의 서버에 저장하지 않습니다. Open-Meteo는 접속 주소와 좌표가 담긴 기록을 90일 뒤 지운다고 밝히고 있습니다. 누르지 않으면 전달되지 않습니다.'] : []),
    // What YouTube's API policies ask a policy to say (Developer Policies III.A.2, read 2026-11-18): that YouTube API Services
    // are used, a link to Google's privacy policy, what of the API's data is kept and how, and what the player collects.
    ...(info.youtube ? ['YouTube (Google LLC, 미국 등): 곡 상세에서 "YouTube로 듣기"를 누른 경우에만, 서비스의 서버가 YouTube API 서비스로 그 곡의 제목과 가수 이름을 검색해 재생할 영상을 고르고, YouTube의 플레이어(개인정보 보호 강화 모드, youtube-nocookie.com)를 화면 안에 불러옵니다. 서버가 보내는 것은 곡 제목과 가수 이름뿐이며 이용자의 정보는 보내지 않습니다. 고른 영상의 번호는 같은 곡을 다시 검색하지 않도록 서버의 메모리에 최대 7일 두며(YouTube 정책상 30일을 넘지 않음), 데이터베이스에는 저장하지 않습니다. 플레이어를 불러오면 이용자의 브라우저가 YouTube에 직접 연결되어 접속 주소(IP), 브라우저와 기기 정보, 재생 기록이 YouTube(Google)로 전달되며, YouTube는 쿠키 등으로 기기에 정보를 저장하거나 읽을 수 있습니다. 서비스는 플레이어에 광고를 붙이지 않지만 YouTube가 영상에 광고를 보여줄 수 있습니다. 그 처리는 Google 개인정보처리방침(https://policies.google.com/privacy)을 따릅니다. 버튼을 누르지 않으면 검색하거나 플레이어를 불러오지 않습니다.'] : []),
    'GitHub, jsDelivr, Wikimedia: 화면, 글꼴, 일부 이미지를 전달합니다. 페이지와 이미지를 불러올 때 접속 주소(IP)가 전달됩니다.',
    '지도·레시피·동영상·음악 서비스로 가는 링크: 누르면 그 서비스가 열리며 메뉴나 곡의 이름이 검색어로 전달됩니다. 누르지 않으면 전달되지 않습니다.',
    '"말로 입력": 브라우저의 음성 인식 기능을 쓰며, 이때 음성이 브라우저 제공사의 음성 인식 서비스로 전송될 수 있습니다. 서비스는 인식된 글자만 받습니다. 쓰지 않으면 전송되지 않습니다.',
  ];
  return [
    { title: '1. 처리하는 정보, 목적, 근거', blocks: [
      '계정을 만들지 않으면 이름이나 이메일을 받지 않습니다. 취향, 즐겨찾기, 추천 기록은 이용 중인 브라우저의 저장소(localStorage)에만 남습니다. 서버에는 아래에 적은 추천 요청 내용의 통계 기록, 직접 보낸 오류 신고와 의견, 접속 기록과 오류 기록, 개인을 알아볼 수 없는 이용 통계만 남습니다.',
      '동의를 받아 처리하는 정보(개인정보 보호법 제15조 제1항 제1호)',
      [
        '계정 정보(가입 시): 이메일 주소, 이름(별명), 암호화해 저장하는 비밀번호, 약관 동의 일시와 버전, 이메일을 확인한 일시. 로그인과 계정 식별, 가입 확인과 비밀번호 재설정 안내에 씁니다. 동의하지 않아도 계정 없이 서비스를 이용할 수 있습니다.',
      ],
      '동의 없이 처리하는 정보와 그 근거',
      [
        '동기화 데이터(로그인 시): 화면에 보이는 이름, 취향으로 등록한 항목과 메모, 취향 유형 검사의 결과, 즐겨찾기, 저장해 둔 조건 묶음, 추천 기록(입력한 문장, 조건, 결과, 선택과 평가), 화면 설정, 건강 관련 입력에 동의한 사실. 다른 기기에서 이어 쓰기 위해 계정에 저장합니다. 근거: 이용자가 요청한 서비스의 제공(같은 항 제4호).',
        '추천 요청 내용: 입력한 문장과 조건은 추천을 만드는 데 쓰고, 같은 문장을 다시 물을 때 빨리 답하도록 서버의 메모리에 잠시 둡니다(서버가 다시 시작되면 사라집니다). 데이터베이스에는 조건과 추천 결과만 통계 목적으로 기록하며, 이 기록은 계정이나 이용자와 연결하지 않고 입력한 문장 원문도 남기지 않습니다. AI가 추천한 메뉴와 곡의 이름은 다음 추천에 쓰기 위해 목록에 저장합니다. 근거: 이용자가 요청한 서비스의 제공(제4호).',
        '오류 신고: 신고한 항목, 종류, 적은 내용. 로그인 상태였다면 신고한 계정도 함께 기록합니다. 정보 오류를 고치는 데 씁니다. 근거: 이용자가 요청한 조치의 이행(제4호).',
        '의견("의견 보내기"를 쓴 경우): 고른 종류, 적은 내용, 적은 경우 답장 받을 이메일, 보낸 화면의 이름과 앱 버전. 로그인 상태여도 계정과 연결하지 않으며, 보낸 횟수는 접속 주소를 복원할 수 없게 변환한 값으로 셉니다. 답장과 서비스 개선에 씁니다. 근거: 이용자가 요청한 조치의 이행(제4호).',
        '접속 기록: 접속 주소(IP), 요청 시각과 경로. 장애 대응과 부정 이용 방지에 씁니다. 하루 이용 한도, 비밀번호를 틀린 횟수, 확인·재설정 메일과 이용 통계 신호를 보낸 횟수는 접속 주소나 이메일 주소를 복원할 수 없게 변환한 값으로 셉니다. 근거: 서비스를 안전하게 운영하고 부정 이용을 막기 위한 정당한 이익(제6호).',
        '오류 기록: 화면에 오류가 나면 오류 메시지, 오류가 난 코드의 위치, 화면의 종류, 앱 버전을 서버에 보냅니다. 이메일 주소나 로그인 토큰처럼 보이는 부분은 지우고 보내며, 계정 정보는 담지 않습니다. 다만 오류 메시지에 화면에 있던 내용의 일부가 섞일 수 있습니다. 접속 기록과 같은 기간 보관합니다. 근거: 장애를 찾아 고치기 위한 정당한 이익(제6호).',
      ],
      '이용 통계: 날짜마다 음식·음악 추천, 짝꿍 추천, 취향 유형 테스트, 가입, 로그인, 의견 같은 기능이 몇 번 쓰였는지와, 그날 처음 서비스를 연 브라우저 수만 셉니다. 이 횟수 표에는 계정, 접속 주소, 브라우저를 알아볼 수 있는 값을 함께 남기지 않아 개인정보가 아닙니다. 브라우저는 그날 방문을 이미 셌는지 알기 위해 날짜만 저장합니다. 서비스를 개선하고 운영 상태를 보는 데 쓰며 400일 보관합니다. 다만 한 곳에서 횟수를 부풀리지 못하게, 브라우저가 보내는 신호의 하루 횟수는 위 접속 기록 항목처럼 접속 주소를 복원할 수 없게 변환한 값으로 세고 7일 뒤 지웁니다.',
      '주민등록번호, 결제 정보, 정확한 위치, 음성은 수집하지 않습니다.',
      '민감정보(건강): 서비스는 건강에 관해 묻지 않지만, 입력란에 알레르기나 질환처럼 건강과 관련된 표현을 적으면 그 글을 기록에 남기거나 서버로 보내기 전에 따로 동의를 받습니다(개인정보 보호법 제23조 제1항 제1호). 동의하면 그 내용은 위의 추천 요청 내용, 동기화 데이터, 오류 신고와 같은 방법과 기간으로 처리되고, 상황 문장과 취향에 적은 이유는 추천을 만들 때 Google LLC로 전송됩니다. 동의한 사실(동의한 때와, 동의한 내용의 판)은 취향·기록과 함께 저장합니다. 동의하지 않으면 그 글은 기록에 남기거나 서버로 보내지 않으며, "땅콩 제외"처럼 재료 이름만 적어 같은 추천을 받을 수 있습니다. 이미 남아 있는 기록에서 그런 표현이 발견되면 동의할지 그 글을 지울지 묻고, 답할 때까지 계정 동기화를 멈춥니다. 동의는 설정 > 데이터 관리에서 언제든 철회할 수 있으며, 철회하면 건강과 관련된 표현이 든 문장과 메모를 지웁니다. 표현은 정해 둔 낱말로 찾으므로 놓치는 경우가 있을 수 있습니다. 건강에 관한 내용을 남기고 싶지 않다면 적지 말아 주세요. "의견 보내기"에는 건강과 관련된 표현을 적을 수 없습니다(보내기 전에 다시 써 달라고 안내합니다).',
      '종교, 정치적 견해 같은 그 밖의 민감한 정보와 다른 사람의 개인정보는 입력란에 적지 말아 주세요.',
    ] },
    { title: '2. 보관 기간과 파기', blocks: [[
      '계정 정보와 동기화 데이터: 계정을 삭제할 때까지. 삭제하면 바로 지우며, 데이터베이스 백업에는 최대 7일 더 남았다가 사라집니다.',
      '이메일을 확인하지 않은 가입 신청: 7일. 확인 링크가 쓰일 수 있는 하루를 더해 신청한 때부터 8일이 지나면, 매일 한 번 정리할 때 지웁니다. 한 번이라도 로그인한 계정(이메일 확인 전에 만든 계정 포함), 저장된 데이터가 있는 계정은 이 정리로 지우지 않습니다.',
      '의견: 받은 날부터 1년. 1년이 지나면 매일 한 번 정리할 때 지우며, 운영자가 처리를 마친 의견은 그 전에 지울 수 있습니다.',
      '오류 신고: 서비스를 운영하는 동안. 신고에는 개인을 알아볼 수 있는 내용을 적지 말아 주세요. 계정을 삭제하면 신고와 계정의 연결을 끊습니다.',
      '접속 기록: 30일. 하루 이용 한도, 비밀번호를 틀린 횟수, 확인·재설정 메일과 의견을 보낸 횟수의 기록: 7일. 7일이 지난 기록은 그 뒤 이용 횟수를 세는 요청이 처음 들어올 때 지웁니다. 계정 번호로 센 기록은 계정을 삭제할 때 함께 지웁니다.',
      '추천 통계 기록과 AI가 추천한 메뉴·곡의 이름: 서비스를 운영하는 동안. 이용자와 연결되지 않는 기록입니다.',
      '이용 통계(날짜별 횟수): 400일. 개인과 연결되지 않는 기록입니다.',
      '브라우저에 저장된 데이터: 이용자가 지울 때까지. 설정 > 데이터 관리의 "이 브라우저의 데이터 모두 초기화"는 취향·기록과 그 보관본, 미리듣기·곡 확인 같은 임시 저장까지 이 브라우저에서 모두 지웁니다.',
    ], '파기 방법: 보관 기간이 끝났거나 삭제를 요청받은 정보는 데이터베이스에서 해당 기록을 삭제하는 방법으로 파기합니다. 자동 백업과 접속 기록은 위 기간이 지나면 보관 서비스에서 자동으로 삭제되고, 배포 전에 따로 만든 백업은 운영자가 7일 안에 지웁니다. 개인정보를 종이 문서로 보관하지 않습니다. 다른 법령에 따라 따로 보존하는 개인정보는 없습니다.'] },
    { title: '3. 제3자 제공', blocks: [
      '서비스는 이용자의 개인정보를 제3자에게 제공하거나 판매하지 않습니다. 법령에 따라 요청받은 경우에만 예외로 합니다.',
    ] },
    { title: '4. 처리 위탁과 국외 이전', blocks: [
      '서비스를 제공하는 데 필요한 일을 아래 업체에 맡깁니다(처리 위탁). 국외로 이전되는 경우는 이용자가 요청한 서비스를 제공하기 위한 위탁으로, 개인정보 보호법 제28조의8 제1항 제3호에 따라 아래 내용을 알립니다. 각 업체와의 데이터 처리 약정에 보안 조치와 맡긴 목적 밖의 이용 금지가 정해져 있습니다.',
      entrusted,
      '국외 이전을 거부하는 방법과 그 효과: 추천이나 문장 해석을 요청하지 않으면 Google LLC로, 가입하지 않고 비밀번호 재설정도 요청하지 않으면 Resend로 정보가 전송되지 않습니다. 계정은 이메일 확인을 거쳐야 만들 수 있으므로, Resend로의 전송을 원하지 않으면 계정 없이 이용할 수 있습니다. 다만 AI 추천은 서비스의 기본 기능이어서, 이를 원하지 않으면 추천을 받을 수 없습니다. 계정은 설정에서 언제든 삭제할 수 있고, 그 밖의 요청은 아래 문의 주소로 보내 주세요.',
    ] },
    { title: '5. 브라우저가 직접 연결하는 외부 서비스', blocks: [
      '아래는 운영자가 정보를 맡기는 곳이 아니라, 화면을 보여 주거나 기능을 쓸 때 이용자의 브라우저가 직접 연결하는 서비스입니다. 연결할 때 접속 주소(IP)와 아래에 적은 내용이 그 서비스에 전달되며, 그 뒤의 처리는 각 서비스의 개인정보 처리방침을 따릅니다. 일부는 국외에 있습니다.',
      direct,
    ] },
    { title: '6. 이용자의 권리와 행사 방법', blocks: [[
      '열람·수정: 설정에서 화면에 보이는 이름과 비밀번호를 바꾸고, "내 취향"과 "추천 기록"에서 저장된 내용을 보고 고칠 수 있습니다. 가입할 때 적은 이름과 이메일의 수정은 아래 문의로 요청해 주세요.',
      '삭제와 동의 철회: 설정에서 계정과 계정 데이터를 삭제할 수 있습니다. 계정을 삭제하면 가입할 때 한 동의가 철회되고 계정 정보를 바로 지웁니다. 브라우저의 데이터는 "데이터 관리"에서 지웁니다.',
      '내보내기: "데이터 관리"의 백업으로 취향과 기록을 파일로 받을 수 있습니다.',
      '보낸 의견의 삭제: 의견은 계정과 연결되지 않으므로, 보낸 때와 내용을 적어 아래 문의 주소로 요청해 주세요.',
      `그 밖의 요청(열람, 정정, 삭제, 처리 정지)과 문의는 ${where(info)} 로 보내주세요. 요청을 받은 날부터 10일 안에 처리 결과를 알려드립니다. 본인인지 확인하려고 가입한 이메일로 답장을 요청할 수 있습니다. 대리인이 요청할 때는 위임장을 함께 보내주세요. 요청을 따를 수 없는 경우에는 그 이유와 이의를 제기하는 방법을 알려드립니다.`,
    ]] },
    { title: '7. 쿠키와 브라우저 저장소', blocks: [
      '서비스는 광고·추적용 쿠키를 쓰지 않습니다. 취향, 기록, 로그인 상태, 화면 설정, 연령을 확인한 사실과 건강 관련 입력에 동의한 사실, 그날 방문을 이미 셌는지(날짜만)를 브라우저 저장소에 보관하며, 이는 서비스 동작에 필요한 저장입니다.',
      '브라우저 설정에서 이 사이트의 데이터 저장을 막거나 저장된 데이터를 지울 수 있습니다. 그렇게 하면 이 브라우저에 취향, 기록, 로그인 상태가 남지 않습니다. 계정에 저장한 내용은 다시 로그인하면 불러옵니다.',
      ...(info.player ? ['곡 상세에서 Apple Music 플레이어를 열면, 그 플레이어는 Apple의 쿠키와 저장소를 따로 사용합니다. 이는 Apple이 관리하며 서비스의 "데이터 관리"로는 지워지지 않습니다.'] : []),
      ...(info.youtube ? ['곡 상세에서 YouTube 플레이어를 열면, 그 플레이어는 YouTube(Google)의 쿠키와 저장소를 따로 사용할 수 있습니다. 이는 YouTube가 관리하며 서비스의 "데이터 관리"로는 지워지지 않습니다. 브라우저 설정에서 youtube-nocookie.com과 youtube.com의 데이터를 지우거나 막을 수 있습니다.'] : []),
    ] },
    { title: '8. 안전하게 지키기 위한 조치', blocks: [[
      '비밀번호는 복원할 수 없는 방식(PBKDF2)으로 변환해 저장합니다.',
      '브라우저와 서버 사이의 통신은 암호화(HTTPS)합니다.',
      '비밀번호를 바꾸거나 "모든 기기에서 로그아웃"을 하면 이전 로그인은 모두 끝납니다. 비밀번호를 여러 번 틀리면 한동안 로그인을 막습니다.',
      '서버와 데이터베이스에는 운영자 한 사람만 접근하며, 서버와 데이터베이스의 설정을 바꾼 관리 작업의 기록은 클라우드 서비스에 400일 동안 남습니다.',
      '서버의 비밀 값은 별도의 비밀 저장소에 두고, 데이터베이스는 매일 백업합니다.',
    ]] },
    { title: `9. 만 ${MIN_AGE}세 미만`, blocks: [
      `서비스는 만 ${MIN_AGE}세 이상을 대상으로 하며, 그 미만인 사람의 정보를 알면서 수집하지 않습니다. 해당하는 계정을 확인하면 삭제합니다. 만 14세 미만 아동의 개인정보는 처리하지 않습니다.`,
    ] },
    { title: '10. 책임자와 문의', blocks: [
      `개인정보 보호책임자: ${who(info)} · 문의: ${where(info)}`,
      '개인정보 침해에 관한 상담과 신고는 개인정보침해신고센터(privacy.kisa.or.kr, 국번 없이 118), 개인정보분쟁조정위원회(www.kopico.go.kr, 1833-6972), 경찰청(ecrm.police.go.kr, 국번 없이 182)에 할 수 있습니다.',
    ] },
    { title: '11. 방침의 변경', blocks: [
      '이 방침을 바꿀 때는 시행 7일 전(이용자에게 중요한 변경은 30일 전)부터 서비스 화면에 알립니다. 수집하는 항목이나 이용 목적을 바꾸지 않고 설명을 보완하는 경우에는 바꾼 날 아래 이력에 적습니다.',
      [
        `${versionLabel(LEGAL_VERSION)}: 지금의 판. 개인을 알아볼 수 없는 이용 통계(날짜별 기능 이용 횟수와 하루 방문 브라우저 수, 400일 보관), 그 방문을 세려고 브라우저에 두는 날짜, 통계 신호를 부풀리지 못하게 세는 하루 횟수(접속 기록과 같은 방식, 7일)를 적었습니다. 이전 판은 이 문서 아래의 링크에서 볼 수 있습니다.`,
        `2026-11-18 (그날 두 번째 판): 가입할 때 이메일 확인을 받고(이메일 확인 일시, 가입 확인 메일의 발송, 확인하지 않은 가입의 삭제), "의견 보내기"로 받은 의견(항목·목적·근거·보관 기간·삭제 방법)을 더했습니다. 서비스를 공개하기 전(비공개 베타 준비 중)이어서 알림 기간 없이 바로 시행했습니다.`,
        '2026-11-18: 2026-11-17 판에 그날과 다음 날 보탠 내용(아래)을 하나의 판으로 정리했습니다. 수집하는 항목과 이용 목적은 2026-11-17 판의 마지막 내용과 같습니다.',
        '2026-11-17: 처음 시행.',
        '2026-11-17 보완: 메일 발송 업체(Resend), 파기 방법, 브라우저 저장을 막는 방법, 한도 기록을 지우는 시점을 적었습니다.',
        '2026-11-17 보완: 건강과 관련된 표현을 적었을 때 따로 동의를 받는 절차를 넣고 민감정보 항목을 적었습니다.',
        ...(info.player ? ['2026-11-17 보완: 곡 상세에서 여는 Apple Music 플레이어와, 플레이어를 열었을 때 Apple이 수집하는 정보를 적었습니다.'] : []),
        ...(info.youtube ? ['2026-11-18 보완: 곡 상세의 YouTube 플레이어와 YouTube API 서비스 사용, 플레이어가 처리하는 정보를 적었습니다.'] : []),
        '2026-11-17 보완: 처리 근거, 제3자 제공 여부, 처리 위탁과 국외 이전(이전 항목·국가·시기와 방법·보유 기간·거부 방법), 권리 행사 기한, 관리 접근 기록, 구제 기관을 법이 정한 기재사항에 맞춰 다시 정리했습니다. 수집하는 항목과 이용 목적은 바뀌지 않았습니다.',
      ],
      `그 밖에 이전 내용이 필요하면 ${where(info)} 로 요청해 주세요.`,
    ] },
  ];
}
