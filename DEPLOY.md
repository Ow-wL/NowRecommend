# 지금 추천 — 배포 가이드

상태: **공개 배포 완료(2026-10-19)**. 프론트엔드는 GitHub Pages, API와 DB는 Google Cloud(Cloud Run + Cloud SQL)에 있습니다. [plans-rag.md](./plans-rag.md) §12 결정 2의 결과입니다.

- 사이트: <https://ow-wl.github.io/NowRecommend/>
- API: <https://nowrecommend-api-183982128363.asia-northeast3.run.app> (`/api/health`로 상태 확인)
- 배포 커밋: `48bb706`(2026-10-26, 음악 AI 실험·음악 226곡). API 리비전 `nowrecommend-api-00003-mjt`, 시드 작업 실행 `nowrecommend-seed-wsrvm`(추가 211·임베딩 211). Pages 배포와 서버 테스트 모두 성공했습니다.

## 1. 현재 구성

GCP 프로젝트는 `harness-recommend`, 리전은 `asia-northeast3`(서울)입니다. gcloud의 기본 프로젝트가 다를 수 있으니 모든 명령에 `--project harness-recommend`를 붙입니다.

| 자원 | 이름 | 설정 |
|---|---|---|
| API | Cloud Run 서비스 `nowrecommend-api` | 포트 8000, 메모리 512Mi, CPU 1, 인스턴스 0~1개, 동시 요청 40, 공개 접근 |
| DB | Cloud SQL `nowrecommend-db` | PostgreSQL 17 + pgvector 0.8.5, `db-f1-micro`(Enterprise), HDD 10GB, 단일 영역, **자동 백업 끔** |
| 데이터베이스·사용자 | `nowrecommend` / `nowrecommend` | 비밀번호는 무작위 생성 후 아래 비밀 값에만 저장 |
| 이미지 | Artifact Registry `nowrecommend` | `asia-northeast3-docker.pkg.dev/harness-recommend/nowrecommend/api:<커밋 앞 7자리>` |
| 비밀 값 | Secret Manager `gemini-api-key`, `database-url` | Cloud Run에 `GEMINI_API_KEY`, `DATABASE_URL`로 주입 |
| 서비스 계정 | `nowrecommend-api@harness-recommend.iam.gserviceaccount.com` | Cloud SQL 클라이언트, 두 비밀 값 읽기 권한만 |
| 데이터 작업 | Cloud Run 작업 `nowrecommend-seed` | `alembic upgrade head` → `app.cli.seed` → `app.cli.embed` |
| 프론트엔드 연결 | 저장소 Actions 변수 `VITE_API_BASE_URL` | 위 API 주소. Pages 빌드가 이 값으로 서버 모드가 됩니다 |

API 환경 변수: `CORS_ORIGINS=["https://ow-wl.github.io"]`, `LOG_RAW_TEXT=false`(입력 문장 원문을 저장하지 않음, 결정 4), `TRUST_PROXY=true`(요청 제한을 실제 사용자 IP 기준으로), `LLM_MODEL=gemini-3.5-flash-lite`(2026-10-20부터, 아래 §4). 나머지는 기본값입니다.

- `DATABASE_URL`은 Cloud SQL 유닉스 소켓을 씁니다. 형식은 `postgresql+psycopg://nowrecommend:<비밀번호>@/nowrecommend?host=/cloudsql/harness-recommend:asia-northeast3:nowrecommend-db`입니다.
- API는 **한 인스턴스**만 띄웁니다. 요청 제한·쿨다운·캐시가 프로세스 메모리에 있어서, 여러 인스턴스로 늘리면 인스턴스마다 따로 셉니다.
- 요청이 없으면 인스턴스가 0개로 줄어서, 한동안 쉰 뒤 첫 요청은 몇 초 더 걸립니다.
- 카탈로그는 음식 16개·음악 226곡입니다(음악 211곡은 `server/data/reviewed_items.json`의 1차 검수 AI 초안). 음식 초안 86개는 검수 전이라 로컬 DB에만 있습니다.
- 음악 AI 실험(`#/lab`)의 B 방식은 `POST /api/lab/music/free`를 쓰며 같은 Gemini 키·한도를 씁니다.

## 2. 다시 배포하기

### 서버 코드를 바꿨을 때

프로젝트 루트에서 실행합니다. 이미지 안에는 `shared/`와 `server/`만 들어가고, `.dockerignore`가 `.env*`를 뺍니다.

```bash
TAG=$(git rev-parse --short HEAD)
IMG=asia-northeast3-docker.pkg.dev/harness-recommend/nowrecommend/api:$TAG
docker build -f server/Dockerfile -t $IMG .
docker push $IMG
gcloud run deploy nowrecommend-api --project harness-recommend --region asia-northeast3 --image $IMG
```

- 컨테이너는 시작할 때 `alembic upgrade head`를 실행하므로 마이그레이션은 따로 하지 않아도 됩니다.
- 환경 변수·비밀 값·Cloud SQL 연결은 이전 리비전 설정을 그대로 이어받습니다.

### 카탈로그를 바꿨을 때

`server/data/seed_items.json`을 바꿨거나, 승인한 AI 초안을 `python -m app.cli.review publish`로 `server/data/reviewed_items.json`에 내보내 커밋했다면 새 이미지를 만든 뒤 작업 이미지를 바꾸고 다시 실행합니다. 시드 작업은 두 파일을 차례로 넣고, 시드와 임베딩은 바뀐 항목만 처리합니다.

```bash
gcloud run jobs update nowrecommend-seed --project harness-recommend --region asia-northeast3 --image $IMG
gcloud run jobs execute nowrecommend-seed --project harness-recommend --region asia-northeast3 --wait
```

### 프론트엔드를 바꿨을 때

`main`에 push하면 `.github/workflows/deploy-pages.yml`이 단위 테스트·빌드·배포를 합니다. 빌드할 때 `VITE_API_BASE_URL` 변수를 읽습니다. `server/`·`shared/`를 바꾸면 `server-ci.yml`도 함께 돕니다.

## 3. 확인과 되돌리기

1. `curl https://nowrecommend-api-183982128363.asia-northeast3.run.app/api/health`가 200이고 `pgvector.installed`와 `llm.configured: true`가 보여야 합니다.
2. 사이트에서 추천을 한 번 받고, 개발자 도구 Network에 `/api/catalog`·`/api/parse`·`/api/recommend`가 보이는지 확인합니다.
3. 결과 화면에 "기본 방식으로 추천했어요"가 뜨면 AI 재순위나 문장 임베딩이 실패한 것입니다. 주로 Gemini 한도 때문입니다(§4).
4. 서버 로그: `gcloud run services logs read nowrecommend-api --project harness-recommend --region asia-northeast3 --limit 50`

되돌리기:

- **사이트를 서버 없이 돌리기**: 저장소 변수 `VITE_API_BASE_URL`을 지우고 Pages 워크플로를 다시 실행하면, 내장 카탈로그와 브라우저 규칙만 쓰는 오프라인 모드로 돌아갑니다.
- **API만 이전 버전으로**: `gcloud run services update-traffic nowrecommend-api --project harness-recommend --region asia-northeast3 --to-revisions <이전 리비전>=100`
- **전부 내리기**(비용을 멈출 때): 위처럼 오프라인 모드로 돌린 뒤 Cloud SQL 인스턴스와 Cloud Run 서비스를 삭제합니다. DB 삭제는 되돌릴 수 없지만, 카탈로그는 시드 파일로 다시 만들 수 있습니다.

## 4. 비용과 제한

- **비용**: GCP 무료 크레딧($300)에서 나갑니다. 고정비는 주로 Cloud SQL `db-f1-micro`로 월 약 $10 안팎(추정)입니다. Cloud Run·Artifact Registry·Secret Manager는 지금 사용량이면 무료 범위이거나 아주 적습니다. 실제 금액은 GCP 결제 화면에서 확인합니다.
- **Gemini 모델과 한도**: 코드 기본값 `gemini-3.6-flash`는 무료 등급에서 생성 요청이 분당 5회, 하루 20회라(R4 실측) 공개 시연에서는 금방 소진됩니다. 그래서 배포 서버는 `LLM_MODEL=gemini-3.5-flash-lite`를 씁니다. 2026-10-20 대표 10건 비교에서 Lite는 9건이 검증을 통과했고(1건 504), 고른 항목은 3.6과 비슷했지만 "평소 취향" 이유가 "새로운 취향" 위주로 약하고 조건 해석은 더 보수적이었습니다. 되돌리려면 `gcloud run services update nowrecommend-api --project harness-recommend --region asia-northeast3 --update-env-vars LLM_MODEL=gemini-3.6-flash`. 한도를 넘거나 모델이 10초 안에 답하지 않으면 결과가 `retrieval_only`(유사도 결과와 템플릿 이유)로 나옵니다. 키가 결제가 켜진 프로젝트에 속해 있으면 무료 한도 대신 요금이 청구될 수 있으니, AI Studio에서 키의 소속 프로젝트를 확인합니다.
- **백업 없음**: 서버 DB에는 카탈로그와 요청 로그만 있습니다. 사용자 취향·기록은 각 브라우저에 저장됩니다(결정 1).
- 키가 로그·화면·저장소에 노출되면 즉시 새 키를 만들고 `gcloud secrets versions add gemini-api-key --project harness-recommend --data-file=<파일>`로 바꾼 뒤 서비스를 다시 배포합니다.

## 5. 로컬 시연

```powershell
docker compose up -d --build
docker compose exec api python -m app.cli.seed
docker compose exec api python -m app.cli.embed
$env:VITE_API_BASE_URL = 'http://127.0.0.1:8010'
try { npm run dev } finally { Remove-Item Env:VITE_API_BASE_URL -ErrorAction SilentlyContinue }
```

브라우저는 `http://127.0.0.1:5173`으로 엽니다. 로컬 API의 CORS 허용 주소이기 때문입니다.
