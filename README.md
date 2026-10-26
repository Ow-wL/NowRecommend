# 지금 추천

React·TypeScript·Vite로 만든 음식·음악 추천 앱입니다. 밝고 단정한 기본 화면([DESIGN.md](./DESIGN.md) v2.1 "클린 라이트", 상단 메뉴·모바일 하단 탭)에서 평소 취향과 이번 요청 조건을 분리하고, 추천 이유를 확인한 뒤 최종 선택을 기록합니다. 다크·시스템 테마와 강조색 설정도 제공합니다.

공개 사이트 [지금 추천](https://ow-wl.github.io/NowRecommend/)은 Google Cloud의 추천 API(유사도 검색 + AI 재순위)와 연결되어 있습니다. 배포 구성은 [DEPLOY.md](./DEPLOY.md)에 있습니다.

## 실행과 검증

Node.js 22와 Microsoft Edge를 사용합니다.

```powershell
npm install
npm run dev
npm test
npm run build
npm run test:e2e
```

기본 주소는 `http://127.0.0.1:5173`입니다. 브라우저 테스트 설정은 `channel: msedge`이며, 시스템 Edge가 없으면 `npx playwright install msedge`로 준비합니다. Chromium 설치만으로 이 설정의 Edge를 대체할 수는 없습니다.

브라우저 테스트는 두 프로젝트로 나뉩니다.

- `offline`: 기존 스펙. API 주소 없이 지정 포트(기본 5173)에서 실행합니다.
- `api`: `tests/api/`. 다음 포트(기본 5174)에 가짜 API 주소 `http://127.0.0.1:5999`로 띄운 dev 서버에서 실행하고, 요청은 route로 가로챕니다. 실제 서버나 Gemini는 호출하지 않습니다.

다른 프로젝트가 5173을 사용하면 테스트 실행에만 임시 포트를 지정합니다(서버 모드 테스트는 그다음 포트를 사용). 기본 개발·테스트 포트는 바뀌지 않으며 기존 서버를 재사용하거나 종료하지 않습니다.

```powershell
$env:PLAYWRIGHT_PORT = '5187'
try { npm run test:e2e } finally { Remove-Item Env:PLAYWRIGHT_PORT -ErrorAction SilentlyContinue }
```

## API 서버와 DB

DB·유사도 검색·AI 재순위 계획은 [plans-rag.md](./plans-rag.md)에 있습니다. R0~R7을 마쳤고 2026-10-19에 Cloud Run + Cloud SQL로 공개 배포했습니다([DEPLOY.md](./DEPLOY.md)). 프론트엔드는 `VITE_API_BASE_URL`이 있을 때만 서버를 호출합니다.

### 프론트엔드의 두 가지 모드

| 모드 | 조건 | 동작 |
|---|---|---|
| 오프라인 | `VITE_API_BASE_URL` 없음(기본 `npm run dev`, 저장소 변수를 지운 Pages 빌드) | 기존과 같이 내장 카탈로그(`src/data.ts`)와 브라우저 규칙으로 즉시 추천 |
| 서버 | `VITE_API_BASE_URL=http://127.0.0.1:8010`(로컬) 또는 배포 API 주소(지금의 Pages 빌드) | `/api/catalog`로 카탈로그를 받고, 추천·재추천·피드백 후 다시 채우기·한 장 교체를 `/api/recommend`로 요청 |

서버 모드로 개발 서버를 띄우려면 아래처럼 실행합니다. API의 CORS 허용 주소가 `127.0.0.1:5173`·`localhost:5173`이므로 포트를 바꾸면 `CORS_ORIGINS`도 함께 바꿔야 합니다.

```powershell
$env:VITE_API_BASE_URL = 'http://127.0.0.1:8010'
try { npm run dev } finally { Remove-Item Env:VITE_API_BASE_URL -ErrorAction SilentlyContinue }
```

- 카탈로그는 응답 형식을 검사한 뒤 탭의 sessionStorage에 캐시합니다. 서버가 응답하지 않으면 캐시나 내장 카탈로그로 계속 동작합니다.
- 추천 요청 중에는 버튼이 "추천을 고르는 중"으로 잠깁니다. 화면을 옮기거나 새 요청을 보내면 이전 응답은 무시합니다.
- 서버 오류·시간 초과 시 "다시 시도하기"와 "기본 추천으로 보기"(브라우저 규칙)를 제공합니다. 기본 추천으로 본 결과에는 안내가 표시됩니다.
- 서버가 답했지만 AI 재순위가 실패했거나 문장 임베딩을 쓰지 못한 경우에도 결과 화면에 "기본 방식으로 추천했어요" 안내가 표시됩니다. 문장 임베딩이 없으면 그 가중치는 조건 태그로 넘어갑니다.
- 장기 비선호·이번 요청 제외를 누르면 해당 카드는 바로 사라지고, 빈자리는 서버 응답으로 채웁니다. 서버가 실패해도 피드백 자체는 유지됩니다.

Docker Desktop이 필요합니다. PostgreSQL 17 + pgvector와 FastAPI 서버를 함께 실행하며, API 컨테이너는 시작할 때 Alembic 마이그레이션을 적용합니다.

```powershell
docker compose up -d --build
docker compose exec api python -m app.cli.seed
docker compose exec api python -m app.cli.embed
curl http://127.0.0.1:8010/api/catalog?category=food
```

- `app.cli.seed`: `server/data/seed_items.json`을 검수 완료 상태로 넣습니다. 여러 번 실행해도 바뀐 항목만 갱신합니다.
- `app.cli.embed`: 검수 완료 항목 중 임베딩 원문·모델·차원이 바뀐 항목만 `gemini-embedding-2`(768차원)로 계산합니다. `--dry-run`은 API를 호출하지 않고 대상만 보여줍니다.
- `src/data.ts`를 고치면 `npx vite-node scripts/export-catalog.ts`로 시드 파일을 다시 만듭니다. 둘이 어긋나면 `npm test`가 실패합니다.
- `GET /api/catalog?category=food|music`은 검수 완료 항목만 프론트 `Item` 형식으로 돌려주고, 카탈로그 전체 내용 기준의 `catalogVersion`을 함께 줍니다.
- `POST /api/recommend`는 다음 순서로 동작합니다.
  1. 필수 제외·비선호·이번 요청 제외·즐겨찾기 범위를 SQL로 거릅니다. `해산물` 같은 묶음 제외는 등록 재료 중 덮는 값(지금은 `생선`)으로 거릅니다.
     - 가격·배달·주변 표현("만원 이하", "배달 가능한")은 문장 임베딩과 AI 재순위에 보내기 전에 지웁니다. 예전 클라이언트가 보낸 `maxPrice`는 무시합니다.
  2. 상황 문장 임베딩, 취향 항목 평균 벡터, 조건 태그 일치를 합쳐 점수를 매깁니다. 등록한 취향 항목은 한 회차에 하나까지만 앞에 두고, 나머지는 요청에 맞는 새 후보 뒤로 보냅니다.
  3. 탐색 온도 `tau`와 MMR로 후보 10개(음악 15곡)를 고릅니다.
  4. `gemini-3.6-flash`가 그 후보 안에서만 3개/5곡을 고르고 취향·상황 이유를 씁니다(`mode: rag`). 서버가 ID·개수·필수 카드를 검증하고 모자라면 유사도 순서로 채웁니다.
  5. 모델 오류·10초 초과·한도 초과(429)·과부하(503)·유효한 선택 없음이면 유사도 상위 결과와 템플릿 이유를 돌려줍니다(`mode: retrieval_only`). 429·503 뒤에는 잠시 모델 호출을 건너뜁니다.
  6. 요청마다 `recommendation_logs`에 기록합니다.
- 현재 키는 무료 등급이라 `gemini-3.6-flash` 생성 요청이 **분당 5회, 하루 20회**로 제한됩니다. 그래서 배포 서버는 2026-10-20부터 `LLM_MODEL=gemini-3.5-flash-lite`를 씁니다(DEPLOY.md §4). 한도를 넘으면 결과가 `retrieval_only`로 나옵니다(plans-rag.md §12 결정 5).
- 재순위 설정: `LLM_MODEL`(기본 `gemini-3.6-flash`), `RERANK_ENABLED`(기본 true), `RERANK_TIMEOUT_MS`(기본·최소 10000).
- `POST /api/parse`는 `{category, text}`를 받습니다.
  - 브라우저와 같은 규칙으로 먼저 해석하고, 규칙이 놓친 단어가 있을 때만 LLM에 물어 결과를 합칩니다. 제외는 합집합입니다.
  - 응답의 `unsupported`는 지원하지 않는 조건(`price`·`delivery`·`place`·`ingredient`)과 문장 속 표현입니다. 조건으로 바꾸지 않고 알리기만 합니다.
  - 응답의 `ai`는 `not_needed`·`used`·`unavailable`·`failed` 중 하나입니다. LLM 해석은 `PARSE_ENABLED=false`로 끌 수 있습니다.
  - 해석 규칙은 `shared/parse-cases.json`으로 프론트 `parseConditions`와 서버가 함께 검사합니다.

### 카탈로그 늘리기 (AI 초안 → 사람 검수)

`server/data/drafts/`에 이름 파일을 두고 실행합니다. 음식은 한 줄에 메뉴 하나, 음악은 `제목 - 아티스트` 형식입니다. 이 폴더는 컨테이너와 연결되며 git에 올리지 않습니다.

```powershell
docker compose exec api python -m app.cli.draft --category food data/drafts/food-names.txt
docker compose exec api python -m app.cli.review export
docker compose exec api python -m app.cli.review import
docker compose exec api python -m app.cli.review publish
```

- `draft`: AI가 설명·태그·재료·이모지·색을 채워 `draft` 상태로 저장합니다. 10개씩 묶어 한 번에 요청하고, 이미 있는 이름은 건너뜁니다. 초안은 추천과 `/api/catalog`에 나오지 않습니다.
- `review export`: `server/data/drafts/review.json`을 만듭니다. 각 항목에 AI가 채운 필드, 경고(알레르기 재료 확인 필요, 모르는 곡, 이름·내용이 비슷한 기존 항목), `decision: pending`이 들어 있습니다.
- 파일을 고쳐 `decision`을 `approve`·`reject`로 바꿉니다. **음식은 재료를 확인한 뒤 `allergensChecked: true`로 바꿔야 승인됩니다.** 재료는 `shared/vocab.json`의 `excludableIngredients`에 있는 이름만 쓸 수 있습니다. 새 재료가 필요하면 먼저 어휘(`exclusions`·`excludableIngredients`)에 더합니다. 등록 재료가 제외 어휘에 없으면 "참깨는 빼줘" 같은 요청이 아무 데도 걸리지 않기 때문입니다.
- `review import`: 승인 항목을 `reviewed`로 바꾸고 임베딩합니다. 오래된 파일로 이미 처리된 항목을 덮어쓰지 않습니다.
- `review publish`: 승인된 AI 항목을 `server/data/reviewed_items.json`으로 내보냅니다. 이 파일을 커밋하면 `app.cli.seed`(배포의 시드 작업 포함)가 기본 시드 다음에 함께 넣으므로, 새로 만든 DB에도 같은 카탈로그가 들어갑니다.
- 무료 한도(하루 약 20회 생성 요청)를 넘으면 해당 묶음은 `모델 오류: ClientError 429`로 건너뜁니다. `--batch 20`으로 요청 수를 줄일 수 있고, 이때는 `RERANK_TIMEOUT_MS`를 넉넉히(예: 150000) 줍니다.
- `python -m app.cli.eval`(server 폴더에서 실행)은 평가 세트 60개(`server/eval/cases.json`)로 기존 규칙·유사도·취향만 방식을 비교하고, 조건 해석 정확도를 잽니다. 결과는 `server/eval/report.md`에 씁니다. `--with-ai`를 주면 AI 경로도 일부 사례에 대해 측정하며, 이때는 생성 한도를 씁니다. 정답 라벨이 기본 시드 31개만 알기 때문에 기본으로 그 안에서만 순위를 매깁니다(`--full-catalog`로 전체).
- 서버 테스트는 GitHub Actions `server-ci.yml`에서 pgvector 컨테이너와 함께 실행됩니다(`server/`·`shared/` 변경 시).
- `POST /api/recommend`·`/api/parse`·`/api/lab/music/free`는 세 경로를 합쳐 클라이언트별 분당 30회로 제한됩니다(`RATE_LIMIT_PER_MINUTE`, 0이면 끔). `TRUST_PROXY=true`이면 `X-Forwarded-For`의 **가장 오른쪽** 주소(프록시가 붙인 값)로 클라이언트를 구분합니다. 왼쪽 값은 클라이언트가 마음대로 보낼 수 있습니다.

### 음악 AI 실험 (`#/lab`)

음악을 DB 곡 목록에서 고르는 방식과 AI가 바로 고르는 방식을 비교하는 실험 페이지입니다([plans-music-ai.md](./plans-music-ai.md)). 서버 모드에서만 홈에 진입 카드가 보입니다.

- A(저장된 곡 목록): 기존 `POST /api/recommend`를 그대로 씁니다.
- B(AI 자유 추천): `POST /api/lab/music/free`. 등록 취향(곡 ID는 서버가 "제목 - 아티스트"로 바꿈)·조건·직접 적은 좋아하는 곡을 보내면 모델이 아는 곡 중 5곡과 확신도를 돌려줍니다. 서버는 빈 값·중복·이미 본 곡·비선호·취향 곡 자체를 걸러내지만, 이름이 글자 그대로 같을 때만 같은 곡으로 봅니다("봄날 - BTS"와 "Spring Day - 방탄소년단"은 다른 곡). 곡이 실제로 있는지도 확인하지 못합니다. 실패하면 대체 결과 없이 실패를 그대로 돌려줍니다.
- B 모델은 `LAB_FREE_MODELS`(기본 `["gemini-3.5-flash-lite","gemini-3.6-flash"]`) 중에서 화면에서 고르고, `GET /api/lab/music/models`가 목록을 줍니다. 같은 이름의 모델은 재순위·해석과 429 쿨다운을 공유합니다. 첫 번째가 아닌 모델은 하루 `LAB_EXTRA_MODEL_DAILY_LIMIT`회(기본 10)까지만 부릅니다.
- 비교 평가(A/비슷/B)·곡별 표시(좋아요·별로예요·없는 곡)·메모는 이 브라우저의 `nowrecommend-lab-v1`에만 저장되고, 추천 기록·취향에는 반영하지 않습니다. 실험 기록에서 집계와 JSON 내려받기를 할 수 있습니다.
- `docker compose exec api python -m app.cli.compare`는 대표 상황 10개를 유사도만 쓴 결과와 AI 재순위 결과로 나란히 출력합니다. 실제 API를 호출하며, 한도에 맞춰 사례 사이에 13초씩 쉽니다.
- 필터 의미는 `shared/filter-cases.json` 사례로 프론트 `eligibleCandidates`와 서버 SQL을 함께 검사합니다. 문장 임베딩이 실패하거나 API 키가 없으면 취향과 태그만으로 순위를 매기고 `contextSimilarity: false`를 표시합니다.

- 호스트 포트 기본값은 DB `5433`, API `8010`입니다. 충돌하면 `DB_PORT`, `API_PORT` 환경 변수로 바꿉니다.
- `GEMINI_API_KEY`는 셸 환경 변수 또는 루트 `.env`에서 읽습니다. health 응답에는 설정 여부만 표시됩니다.
- 태그·제외 어휘의 단일 기준은 `shared/vocab.json`입니다. 프론트(`src/data.ts`)와 서버가 같은 파일을 읽습니다.

서버 단위 테스트(Python 3.12 이상):

```powershell
cd server
py -3.14 -m venv .venv
.venv\Scripts\python -m pip install -e ".[dev]"
.venv\Scripts\python -m pytest
```

`docker compose up -d db` 후 `$env:NOWREC_DB_TESTS='1'`을 설정하면 DB 테스트까지 실행합니다. DB 테스트는 별도의 `nowrecommend_test` 데이터베이스를 새로 만들어 사용하며, 임베딩은 가짜 임베더로 대체해 API를 호출하지 않습니다.

## 사용 흐름

1. 음식 또는 음악 선택 → 처음에만 평소 선호 항목을 고르는 화면을 보여줍니다. 몇 개만 골라도 되고 "취향 없이 바로 추천받기"로 건너뛸 수 있습니다. 취향이 없으면 카드에 취향 이유를 쓰지 않습니다.
2. 상황 입력 → 같은 화면에서 찾은 조건을 확인·수정(필요하면 "조건 직접 고르기") → 추천.
3. 음식 3개·음악 5곡을 기본으로 표시하되 필수 제외 적용 후 실제 후보가 부족하면 실제 개수만 표시. 재추천 순서는 고정 후보 → 이번 요청에서 아직 안 본 후보 → 본 후보입니다. 상황 태그는 거르는 조건이 아니라 순위 기준이라, 맞는 새 후보가 떨어지면 맞지 않는 새 후보를 "조건에 맞는 새 후보가 부족해요" 안내와 함께 보여주고, 정말 다 본 뒤에만 "모두 살펴봤어요"라고 합니다. "추천 중 유일하게 …" 비교 문장은 보이는 카드 묶음이 바뀔 때마다 다시 계산합니다(기록은 당시 묶음 기준). 카드마다 주요 특성과 조건별 충족 여부(✓ 충족, – 해당 없음, △ 일부만 확인)를 보여줍니다.
4. 저장, 이번 요청에서 제외, 개별 항목의 장기 비선호를 구분. 재추천은 미노출 후보를 우선하며 소진 시 재노출을 안내.
5. 음식은 "선택하고 기록" → 완료 화면에서 네이버 지도·만개의레시피 검색으로 이어집니다(검색일 뿐 판매·영업·배달은 확인하지 않음). 음악은 "Apple Music에서 듣기"(확인된 곡 페이지가 있을 때) 또는 "YouTube에서 검색"이 주 버튼입니다. 기록은 실제 식사·감상 완료를 뜻하지 않습니다.
   - 결과 카드의 더보기 › "내 취향에 추가"는 다음 추천의 취향에 실제로 반영합니다. 만족도·메모는 기록용입니다.
6. 기록 상세에서 선택 변경·취소. 같은 조건으로 다시 추천하면 현재 취향을 적용하는 새 요청.
7. 홈 기본 프리셋과 분야별 개인 조건 저장·이름 변경·삭제·적용 미리보기.
8. 즐겨찾기 이름/아티스트·분야·태그 필터·최근 저장순, 표시된 저장 후보 안에서 추천. 범위 부족은 자동 완화하지 않고 전체 후보 전환을 사용자가 선택.
9. 결과의 요청별 고정·한 장 교체·최대 3개 비교와 바로 선택. 새 요청에는 고정·비교를 가져오지 않음.
10. 선택 기록에 만족도·200자 메모. 추천·평소 취향에 자동 반영하지 않음(화면에도 그렇게 안내).

음식·음악의 취향은 독립적입니다. 선택·즐겨찾기·기록은 장기 취향을 자동으로 바꾸지 않습니다. 음악의 YouTube 검색은 새 탭을 열며 음원 재생 기능은 없습니다.

## 입력 해석

규칙 기반으로 알려진 표현만 해석합니다. 예: `안 매운`, `매운 건 빼고`, `밀 제외`, `해산물은 빼고`, `과제`, `산책`, `차분한`, `보컬 없는`.

가격·예산 기능은 2026-10-27에 없앴습니다(판매처 데이터가 없어 정확한 가격을 줄 수 없음). `만원 이하`·`저렴하게`·`가성비` 같은 가격 표현, `배달`·`포장` 같은 배달 표현, `근처`·`주변` 같은 위치 표현, 재료 정보가 없는 제외(`새우` 등)는 입력하는 동안 "지원하지 않는 조건"으로 알리고 다른 조건으로 바꾸지 않습니다. `해산물` 제외는 등록 재료의 `생선`만 거를 수 있어 "일부만 확인할 수 있는 조건"으로 알립니다. "빼줘·말고·없는·알레르기"가 부정하는 범위를 읽습니다. `국물 있는 건 빼줘`·`고소한 거 말고`처럼 "…한 건/거"로 끝나는 구절은 구절 전체를, `오이랑 고수 빼줘`·`점심, 고수, 참깨 빼줘`처럼 나열한 말은 목록 전체를 부정합니다(쉼표 목록은 각 부분이 한 단어일 때만). 부정한 말은 원하는 조건이 되지 않습니다. 뺄 수 있으면 제외로 적용하고(`매콤한 거 말고` → 매콤함 제외, `깨 빼주세요` → 참깨), 뺄 수 없으면 지원하지 않는 조건으로 알립니다(특징은 `국물 제외`·`고소함 제외`, 모르는 재료는 `고수 제외`). 한 글자 재료는 `exclusionShortWords`에 있는 것만 읽습니다. 서버 모드에서 AI가 더한 음식 제외는 문장에 식단·알레르기 표현(비건, 알레르기, 못 먹어요, 안 들어간 등)이나 매운맛 언급이 있을 때만 받습니다. 알아볼 수 없는 표현이 있을 수 있어 입력 화면에 "문장에서 알아본 표현만 조건으로 바꿔요"를 함께 보여줍니다. 사례는 `shared/parse-cases.json`의 `unsupported`가 앞뒤 구현을 함께 검사합니다. 입력하는 동안 규칙으로 찾은 조건이 "이번 요청 조건"에 바로 나타납니다. 서버 모드에서는 "추천받기"를 누를 때 규칙이 놓친 단어가 있으면 AI가 함께 해석하고, 결과 화면에 그 사실과 적용하지 않은 표현을 보여줍니다. AI가 더한 조건이 충돌하면 추천하지 않고 입력 화면에 남습니다.

자동 추출과 직접 선택을 분리합니다. 같은 문장으로 다시 추천받을 때 삭제한 자동 조건을 되살리지 않으며, 새 문장에는 자동 조건만 다시 계산합니다. 충돌 조건은 수정 후 추천할 수 있습니다. 해석하지 못한 표현은 적용하지 않습니다.

## 저장 범위와 복원

- 취향·즐겨찾기·최대 50세션 기록은 사이트 주소별 localStorage에 저장됩니다. 기기 간 동기화는 없습니다.
- 세션당 상세 회차는 최대 10개입니다. 오래된 상세를 정리해도 최종 선택 요약은 보존합니다.
- 입력·단계·결과·일시 제외·누적 노출은 sessionStorage에 보관하여 같은 탭 새로고침과 화면 이동에서 복원합니다.
- 홈 이동만으로 요청을 종료하지 않습니다. 새 요청 시작·명시적 요청 종료·최종 선택 완료에서 활성 요청을 초기화합니다. 브라우저가 닫힌 탭을 복원할 수 있으므로 탭 종료만으로 초기화됨을 보장하지 않습니다.
- 영구 포맷 v2는 기존 `nowrecommend-prototype-v1` 키를 유지합니다. v1 원본은 `nowrecommend-prototype-v1-backup`에 보존합니다. 이전 기록에 없는 이유는 재계산하지 않습니다.
- 손상 데이터는 덮어쓰지 않고 원본 내려받기와 명시적 초기화를 제공합니다. 저장 거부·용량 부족 시 화면 변경과 영구 저장 성공을 구분해 안내합니다.
- 프리셋(분야별 20개·이름 30자), 만족도·메모, 테마·강조색도 영구 데이터에 포함됩니다.
- 가격 제거 전에 저장된 데이터(기록·회차·프리셋의 `maxPrice`, 항목의 `price`·`cost`, 탭의 예산 입력)는 읽을 때 지우고 다시 저장합니다. 백업 가져오기도 같습니다. 기록의 원래 문장과 즐겨찾기·취향 등 다른 데이터는 그대로 둡니다.
- 설정에서 5MB 이하 JSON 백업·가져오기 미리보기·전체 교체와 취향/즐겨찾기/기록/프리셋별 초기화를 제공합니다. 가져오기는 버전·자료형·ID·분야·중복을 검증하고 현재 데이터를 먼저 백업합니다. 교체 전 브라우저 원본은 `nowrecommend-prototype-v1-before-import`에 보존하며 저장 실패 시 기존 데이터를 유지합니다. 진행 중 요청은 백업하지 않고 교체 시 종료합니다.

## 배포

이 폴더가 GitHub 저장소 루트입니다. Settings → Pages → Source에서 GitHub Actions를 사용합니다. `main` 푸시가 `.github/workflows/deploy-pages.yml`의 단위 테스트·빌드·배포를 실행합니다. 지금은 저장소 변수 `VITE_API_BASE_URL`에 배포 API 주소가 있어 Pages가 서버 모드로 빌드됩니다. 변수를 지우면 오프라인 모드로 돌아갑니다. API 서버(Cloud Run + Cloud SQL)의 구성·재배포·되돌리기는 [DEPLOY.md](./DEPLOY.md)에 있습니다.

실제 사이트: [지금 추천](https://ow-wl.github.io/NowRecommend/).

해시 경로(`#/history`)와 상대 정적 자산 경로로 저장소 하위 주소 새로고침을 지원합니다. 로컬과 배포 사이트의 브라우저 저장소는 분리됩니다. 브라우저 테스트는 로컬 검증이며 배포 Actions는 단위 테스트와 빌드를 실행합니다.

## 범위와 남은 작업

브라우저 앱은 plans.md의 P0 및 사용자 승인 P1·P2이고, 서버·DB·AI는 plans-rag.md의 R0~R7입니다. P0 기록은 [IMPLEMENTATION.md](./IMPLEMENTATION.md), P1·P2 기능·검증·시연 동선은 [EXTENSIONS.md](./EXTENSIONS.md), P0 검증은 [VERIFICATION.md](./VERIFICATION.md), 디자인 기준은 [DESIGN.md](./DESIGN.md), 서버 계획과 평가는 [plans-rag.md](./plans-rag.md), 배포는 [DEPLOY.md](./DEPLOY.md)에 있습니다.

브라우저 단독(오프라인) 카탈로그는 미검증 샘플 음식 16개·음악 15곡입니다. 서버 카탈로그에는 2026-10-26에 AI 초안으로 만들고 Claude가 1차 검수한 음악 211곡을 더해 음악 226곡입니다(`server/data/reviewed_items.json`). 음식 초안 86개는 알레르기 확인 전이라 승인하지 않았습니다(로컬 `server/data/drafts/review.json`). 가격 정보는 없으며 등록된 재료는 실제 판매처의 재료를 보증하지 않습니다. 데이터 ID·필드·태그·검색 URL은 자동 검증하지만 실제 곡·아티스트의 운영 검수는 별도입니다. Apple Music 링크는 스토어가 같은 제목·아티스트의 곡으로 돌려준 곡 페이지만 씁니다(`python -m app.cli.media tracks`, 224곡 중 221곡). 나머지는 YouTube 검색을 보여줍니다.

F3~F9 및 라이트·시스템·사용자 강조색 설정, 추천 서버·DB·AI 재순위와 공개 배포를 마쳤습니다. 남은 일:

- 음악 AI 실험(#/lab, 내 취향 › 실험실에서 진입)으로 저장된 곡 목록 방식과 AI 자유 추천 중 하나를 정하기([plans-music-ai.md](./plans-music-ai.md)).
- 음식 초안 86개의 알레르기·태그 검수와 승인.
- 로그인과 취향·기록의 서버 저장·기기 간 동기화(plans-rag.md §12 결정 1). 실험을 마친 뒤 진행합니다.
- 사용자 3명의 과제 수행과 실제 모바일 키보드·스크린리더 검증.

## 코드 구성

- `src/components/`: 공통 카드·모달·기록 상세.
- `src/styles/tokens.css`, `src/styles.css`: 라이트 기본·다크 토큰, 상단 바·하단 탭·흐름 화면 레이아웃, 상태·반응형.
- `src/domain.ts`: 조건 출처·파싱·필터·추천.
- `src/history.ts`: 회차 스냅샷·최종 선택.
- `src/navigation.ts`, `src/sessionStorage.ts`: 해시 탐색·현재 요청 복원.
- `src/storage.ts`: 영구 데이터 검증·v1 변환·저장·손상 원본 보존.
- `src/data.ts`: 샘플 카탈로그·검토 상태·자동 검증.
- `src/api/`: 서버 모드의 카탈로그·추천·해석·실험 요청.
- `src/components/MusicLab.tsx`, `src/lab.ts`: 음악 AI 실험 화면과 브라우저 실험 기록.
- `src/media.json`, `src/media.ts`, `src/components/ItemArt.tsx`: 항목 사진·앨범 커버와 생성 커버(DESIGN.md v3). 앨범 커버는 `python -m app.cli.media covers`(iTunes Search API, 약 15분)로 다시 받고, 영어 제목 후보(`check`)는 사람이 확인한 뒤 표시합니다. 음식 사진은 Wikimedia Commons에서 메뉴별로 골라 촬영자·라이선스와 함께 적습니다.
- `server/`: FastAPI·SQLAlchemy·Alembic 추천 서버, CLI(시드·임베딩·초안·검수·평가), pytest.
- `shared/`: 프론트와 서버가 함께 쓰는 어휘(`vocab.json`)와 공통 사례(`parse-cases.json`, `filter-cases.json`).
