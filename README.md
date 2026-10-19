# 지금 추천

React·TypeScript·Vite로 만든 음식·음악 추천 앱입니다. 기본 다크 UI에서 평소 취향과 이번 요청 조건을 분리하고, 추천 이유를 확인한 뒤 최종 선택을 기록합니다. 라이트·시스템 테마와 강조색 설정도 제공합니다.

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

## API 서버와 DB (개발 중)

DB·유사도 검색·AI 재순위 계획은 [plans-rag.md](./plans-rag.md)에 있습니다. 현재는 R4(AI 재순위·설명)까지 완료된 상태입니다. 프론트엔드는 `VITE_API_BASE_URL`이 있을 때만 서버를 호출합니다.

### 프론트엔드의 두 가지 모드

| 모드 | 조건 | 동작 |
|---|---|---|
| 오프라인 | `VITE_API_BASE_URL` 없음(GitHub Pages 빌드 포함) | 기존과 같이 내장 카탈로그(`src/data.ts`)와 브라우저 규칙으로 즉시 추천 |
| 서버 | `VITE_API_BASE_URL=http://127.0.0.1:8010` | `/api/catalog`로 카탈로그를 받고, 추천·재추천·피드백 후 다시 채우기·한 장 교체를 `/api/recommend`로 요청 |

서버 모드로 개발 서버를 띄우려면 아래처럼 실행합니다. API의 CORS 허용 주소가 `127.0.0.1:5173`·`localhost:5173`이므로 포트를 바꾸면 `CORS_ORIGINS`도 함께 바꿔야 합니다.

```powershell
$env:VITE_API_BASE_URL = 'http://127.0.0.1:8010'
try { npm run dev } finally { Remove-Item Env:VITE_API_BASE_URL -ErrorAction SilentlyContinue }
```

- 카탈로그는 응답 형식을 검사한 뒤 탭의 sessionStorage에 캐시합니다. 서버가 응답하지 않으면 캐시나 내장 카탈로그로 계속 동작합니다.
- 추천 요청 중에는 버튼이 "추천을 고르는 중"으로 잠깁니다. 화면을 옮기거나 새 요청을 보내면 이전 응답은 무시합니다.
- 서버 오류·시간 초과 시 "다시 시도하기"와 "기본 추천으로 보기"(브라우저 규칙)를 제공합니다. 기본 추천으로 본 결과에는 안내가 표시됩니다.
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
  1. 필수 제외·예산·비선호·이번 요청 제외·즐겨찾기 범위를 SQL로 거릅니다.
  2. 상황 문장 임베딩, 취향 항목 평균 벡터, 조건 태그 일치를 합쳐 점수를 매깁니다.
  3. 탐색 온도 `tau`와 MMR로 후보 10개(음악 15곡)를 고릅니다.
  4. `gemini-3.6-flash`가 그 후보 안에서만 3개/5곡을 고르고 취향·상황 이유를 씁니다(`mode: rag`). 서버가 ID·개수·필수 카드를 검증하고 모자라면 유사도 순서로 채웁니다.
  5. 모델 오류·10초 초과·한도 초과(429)·과부하(503)·유효한 선택 없음이면 유사도 상위 결과와 템플릿 이유를 돌려줍니다(`mode: retrieval_only`). 429·503 뒤에는 잠시 모델 호출을 건너뜁니다.
  6. 요청마다 `recommendation_logs`에 기록합니다.
- 현재 키는 무료 등급이라 생성 요청이 **분당 5회, 하루 20회**로 제한됩니다. 한도를 넘으면 결과가 `retrieval_only`로 나옵니다(plans-rag.md §12 결정 5).
- 재순위 설정: `LLM_MODEL`(기본 `gemini-3.6-flash`), `RERANK_ENABLED`(기본 true), `RERANK_TIMEOUT_MS`(기본·최소 10000).
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

1. 음식 또는 음악 선택 → 해당 분야의 평소 선호 항목 5개 이상 등록.
2. 상황 입력 또는 직접 조건 선택 → 조건 확인·수정 → 추천.
3. 음식 3개·음악 5곡을 기본으로 표시하되 필수 제외와 예산 적용 후 실제 후보가 부족하면 실제 개수만 표시.
4. 저장, 이번 요청에서 제외, 개별 항목의 장기 비선호를 구분. 재추천은 미노출 후보를 우선하며 소진 시 재노출을 안내.
5. 이걸로 선택 → 선택 완료 → 당시 이유·조건·결과를 기록. 실제 식사·감상 완료를 뜻하지 않음.
6. 기록 상세에서 선택 변경·취소. 같은 조건으로 다시 추천하면 현재 취향을 적용하는 새 요청.
7. 홈 기본 프리셋과 분야별 개인 조건 저장·이름 변경·삭제·적용 미리보기.
8. 즐겨찾기 이름/아티스트·분야·태그 필터·최근 저장순, 표시된 저장 후보 안에서 추천. 범위 부족은 자동 완화하지 않고 전체 후보 전환을 사용자가 선택.
9. 결과의 요청별 고정·한 장 교체·최대 3개 비교와 바로 선택. 새 요청에는 고정·비교를 가져오지 않음.
10. 선택 기록에 만족도·200자 메모. 추천·평소 취향에 자동 반영하지 않음.

음식·음악의 취향은 독립적입니다. 선택·즐겨찾기·기록은 장기 취향을 자동으로 바꾸지 않습니다. 음악의 YouTube 검색은 새 탭을 열며 음원 재생 기능은 없습니다.

## 입력 해석

규칙 기반으로 알려진 표현만 해석합니다. 예: `8천원`, `1만 5천원`, `15,000원`, `이만원 이하`, `안 매운`, `밀 제외`, `과제`, `산책`, `차분한`, `보컬 없는`.

자동 추출과 직접 선택을 분리합니다. 같은 문장 재확인에는 삭제한 자동 조건을 되살리지 않으며, 새 문장에는 자동 조건만 다시 계산합니다. 직접 예산이 우선하고 빈 직접 예산은 제한 해제입니다. 직접 예산은 100~1,000,000원의 정수만 허용합니다. 충돌 조건은 수정 후 추천할 수 있습니다. 해석하지 못한 표현은 적용하지 않습니다.

## 저장 범위와 복원

- 취향·즐겨찾기·최대 50세션 기록은 사이트 주소별 localStorage에 저장됩니다. 기기 간 동기화는 없습니다.
- 세션당 상세 회차는 최대 10개입니다. 오래된 상세를 정리해도 최종 선택 요약은 보존합니다.
- 입력·단계·결과·일시 제외·누적 노출은 sessionStorage에 보관하여 같은 탭 새로고침과 화면 이동에서 복원합니다.
- 홈 이동만으로 요청을 종료하지 않습니다. 새 요청 시작·명시적 요청 종료·최종 선택 완료에서 활성 요청을 초기화합니다. 브라우저가 닫힌 탭을 복원할 수 있으므로 탭 종료만으로 초기화됨을 보장하지 않습니다.
- 영구 포맷 v2는 기존 `nowrecommend-prototype-v1` 키를 유지합니다. v1 원본은 `nowrecommend-prototype-v1-backup`에 보존합니다. 이전 기록에 없는 이유는 재계산하지 않습니다.
- 손상 데이터는 덮어쓰지 않고 원본 내려받기와 명시적 초기화를 제공합니다. 저장 거부·용량 부족 시 화면 변경과 영구 저장 성공을 구분해 안내합니다.
- 프리셋(분야별 20개·이름 30자), 만족도·메모, 테마·강조색도 영구 데이터에 포함됩니다.
- 설정에서 5MB 이하 JSON 백업·가져오기 미리보기·전체 교체와 취향/즐겨찾기/기록/프리셋별 초기화를 제공합니다. 가져오기는 버전·자료형·ID·분야·중복을 검증하고 현재 데이터를 먼저 백업합니다. 교체 전 브라우저 원본은 `nowrecommend-prototype-v1-before-import`에 보존하며 저장 실패 시 기존 데이터를 유지합니다. 진행 중 요청은 백업하지 않고 교체 시 종료합니다.

## 배포

이 폴더가 GitHub 저장소 루트입니다. Settings → Pages → Source에서 GitHub Actions를 사용합니다. `main` 푸시가 `.github/workflows/deploy-pages.yml`의 단위 테스트·빌드·배포를 실행합니다.

실제 사이트: [지금 추천](https://ow-wl.github.io/NowRecommend/).

해시 경로(`#/history`)와 상대 정적 자산 경로로 저장소 하위 주소 새로고침을 지원합니다. 로컬과 배포 사이트의 브라우저 저장소는 분리됩니다. 브라우저 테스트는 로컬 검증이며 배포 Actions는 단위 테스트와 빌드를 실행합니다.

## 범위와 남은 작업

이번 구현은 plans.md의 P0 및 사용자 승인 P1·P2입니다. P0 기록은 [IMPLEMENTATION.md](./IMPLEMENTATION.md), P1·P2 기능·검증·시연 동선은 [EXTENSIONS.md](./EXTENSIONS.md), P0 검증은 [VERIFICATION.md](./VERIFICATION.md), 디자인 기준은 [DESIGN.md](./DESIGN.md)에 있습니다.

카탈로그는 미검증 샘플 음식 16개·음악 15곡입니다. 가격 범위와 필터용 기준 가격은 다르며 실제 판매 가격·재료를 보증하지 않습니다. 데이터 ID·필드·태그·검색 URL은 자동 검증하지만 실제 곡·아티스트·가격의 운영 검수는 별도입니다.

F3~F9 및 라이트·시스템·사용자 강조색 설정을 구현했습니다. 실제 로그인·서버·AI·DB·동기화는 다음 주 범위입니다. 사용자 3명의 과제 수행과 실제 모바일 키보드·스크린리더 검증은 별도 진행이 필요합니다.

## 코드 구성

- `src/components/`: 공통 카드·모달·기록 상세.
- `src/styles/tokens.css`, `src/styles.css`: 다크 토큰·레이아웃·상태·반응형.
- `src/domain.ts`: 조건 출처·파싱·필터·추천.
- `src/history.ts`: 회차 스냅샷·최종 선택.
- `src/navigation.ts`, `src/sessionStorage.ts`: 해시 탐색·현재 요청 복원.
- `src/storage.ts`: 영구 데이터 검증·v1 변환·저장·손상 원본 보존.
- `src/data.ts`: 샘플 카탈로그·검토 상태·자동 검증.
