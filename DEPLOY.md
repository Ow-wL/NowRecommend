# 지금 추천 — 배포 가이드

상태: **공개 배포 완료(2026-10-19)**. 프론트엔드는 GitHub Pages, API와 DB는 Google Cloud(Cloud Run + Cloud SQL)에 있습니다. [plans-rag.md](./plans-rag.md) §12 결정 2의 결과입니다.

- 사이트: <https://ow-wl.github.io/NowRecommend/>
- API: <https://nowrecommend-api-183982128363.asia-northeast3.run.app> (`/api/health`로 상태 확인)
- 운영 중(2026-10-27 점검): API 리비전 `nowrecommend-api-00006-hnk`(이미지 `c114929`), 시드 작업 마지막 실행 `nowrecommend-seed-4kpc7`, Pages `7bc6a41`. 가격 제거 커밋은 아직 배포하지 않았습니다(§0).

## 0. 가격 제거 배포 순서 (2026-10-27, 아직 배포하지 않음)

가격 제거는 **호환 배포(1단계)**와 **열 삭제(2단계)**로 나눕니다. 지금 운영 중인 API(이미지 `c114929`)의 ORM은 `items.price_label`·`cost`를 읽습니다. 그래서 그 버전이 트래픽을 받거나 되돌릴 대상으로 남아 있는 동안에는 열을 지우면 안 됩니다.

- **확장(expand)과 축소(contract)**: 마이그레이션을 둘로 나눕니다(`server/app/migrations.py`). 확장 마이그레이션은 옛 코드가 무시하는 것만 더하고, 축소 마이그레이션은 옛 코드가 읽는 것을 지웁니다. 축소 마이그레이션에는 `contract = True`가 붙고, 지금은 `0003`(가격 열 삭제)이 그렇습니다.
- **자동으로는 확장만**: API 컨테이너 시작(`server/Dockerfile`의 `python -m app.cli.migrate`)과 새 시드 스크립트(`server/scripts/seed-job.sh`)는 확장 마이그레이션만 적용합니다. 대기 중인 축소 마이그레이션 앞에서 멈추고 로그에 `contract migrations waiting: 0003`을 남깁니다.
- **열 삭제는 따로만**: `0003`은 `python -m app.cli.migrate --contract`로만 실행됩니다. 그냥 `alembic upgrade head`를 실행하면 아무것도 바꾸지 않고 실패합니다. 예를 들어 지금 시드 작업 명령을 그대로 둔 채 이미지만 바꾸는 경우가 그렇습니다(CI만 `NOWREC_ALLOW_CONTRACT=1`로 허용).
- **값 보존과 복원**: `0003`은 지우기 전에 값을 `items_price_backup` 표로 옮깁니다. `--downgrade 0002`는 열과 값을 되돌립니다.

### 0-1. 2026-10-27 읽기 전용 점검으로 확인한 운영 상태

| 항목 | 상태 |
|---|---|
| API 서비스 | `nowrecommend-api`, 트래픽 100% `nowrecommend-api-00006-hnk`, 이미지 `api:c114929`(amd64 매니페스트 `sha256:6e8ad5d3…`) |
| 되돌릴 대상 | `nowrecommend-api-00005-l25`(이미지 `sha256:4e11d7ef…`, 태그 없음, 레지스트리에 남아 있음). 두 리비전 모두 가격 제거 전 코드입니다 |
| 시드 작업 | `nowrecommend-seed`, 이미지 `api:c114929`, 명령 `sh -c "alembic upgrade head && python -m app.cli.seed && python -m app.cli.embed"`, 마지막 실행 `nowrecommend-seed-4kpc7` 성공 |
| DB 마이그레이션 | **0002로 추정**. 배포된 이미지들에는 0001·0002만 있고, 작업 로그에 0003 적용 기록이 없습니다. DB에 직접 접속해 확인하지는 않았습니다 |
| 백업 | Cloud SQL 자동 백업 **꺼짐**, 저장된 백업 **0개** |
| 열 삭제 작업 | `nowrecommend-contract` 없음(2단계에서 만듭니다) |
| Pages | `7bc6a41`로 빌드됨, `VITE_API_BASE_URL=https://nowrecommend-api-183982128363.asia-northeast3.run.app` |

### 0-2. 사전 확인 (변경 없음)

```bash
P="--project harness-recommend"; R="--region asia-northeast3"
git status --short                      # 비어 있어야 합니다. 이미지는 작업 트리 그대로 만들어집니다
git log -1 --oneline                    # 배포할 커밋
gcloud run services describe nowrecommend-api $P $R --format="value(status.traffic)"
gcloud run jobs describe nowrecommend-seed $P $R --format="value(spec.template.spec.template.spec.containers[0].image,spec.template.spec.template.spec.containers[0].args)"
curl -s https://nowrecommend-api-183982128363.asia-northeast3.run.app/api/health
```

트래픽 대상이나 작업 명령이 0-1 표와 다르면 멈추고 원인을 확인합니다.

### 0-3. 1단계: 호환 버전 배포 (가격 열은 그대로)

**1) 백업 만들기.** 시드가 음식 부제와 임베딩을 바꾸므로, 데이터까지 되돌릴 수 있게 먼저 만듭니다.

```bash
gcloud sql backups create --instance nowrecommend-db $P --description "before price removal phase 1"
gcloud sql backups list --instance nowrecommend-db $P --limit 1    # STATUS SUCCESSFUL
```

**2) 이미지 만들기와 올리기.**

```bash
TAG=$(git rev-parse --short HEAD)
IMG=asia-northeast3-docker.pkg.dev/harness-recommend/nowrecommend/api:$TAG
docker build -f server/Dockerfile -t $IMG .
docker push $IMG
```

- 확인: `gcloud artifacts docker tags list asia-northeast3-docker.pkg.dev/harness-recommend/nowrecommend/api $P | grep $TAG`

**3) API 배포.** 환경 변수·비밀 값·Cloud SQL 연결은 이전 리비전 설정을 이어받습니다.

```bash
gcloud run deploy nowrecommend-api $P $R --image $IMG
```

- 확인 1: `gcloud run services describe nowrecommend-api $P $R --format="value(status.traffic)"`에서 새 리비전이 100%여야 합니다.
- 확인 2: 시작 로그에 확장 마이그레이션만 적용됐는지 봅니다.
  ```bash
  gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="nowrecommend-api" AND textPayload:"migrate:"' $P --limit 5 --freshness 1h --format="value(timestamp,textPayload)"
  ```
  `migrate: at 0002; nothing to apply`와 `migrate: contract migrations waiting: 0003`이 보여야 합니다.
- 확인 3: `/api/health`가 200이어야 합니다.
- 확인 4: `POST /api/parse`에 `{"category":"food","text":"혼자 먹을 점심, 참깨는 빼줘"}`를 보내면 `"excluded": ["참깨"]`, `"maxPrice": null`이 와야 합니다. UTF-8로 보내야 해서 Windows Git Bash의 curl 대신 Cloud Shell이나 Python을 씁니다.
- 실패하면:
  - 새 리비전이 뜨지 못하면 Cloud Run이 트래픽을 옮기지 않으므로 그대로 둡니다. DB도 바뀌지 않습니다(확장 마이그레이션 없음).
  - 떴지만 이상하면 `gcloud run services update-traffic nowrecommend-api $P $R --to-revisions nowrecommend-api-00006-hnk=100`으로 되돌립니다.

**호환 기간 안내.** API 배포부터 Pages 배포(4번)까지, 그리고 그 뒤 사용자가 새로고침하기 전까지는 기존 Pages 화면이 새 API를 씁니다. 로컬에서 실제로 확인한 결과는 이렇습니다.

- 추천과 해석은 정상으로 동작합니다. 새 API는 해석 응답에 옛 화면 호환용 `maxPrice: null`을 계속 붙입니다.
- 옛 화면의 음식 카드 부제 뒤에 "· 참고 가격" 글자만 남습니다(가격 값은 없음).
- 이 기간을 짧게 하려고 2)–4)를 이어서 진행합니다.

**4) 시드 작업.** 이미지와 명령을 **한 번에** 바꾼 뒤 실행합니다. 이미지만 바꾸면 남아 있던 `alembic upgrade head`가 0003에서 실패하고 작업이 멈춥니다. 이때 DB는 바뀌지 않습니다.

```bash
gcloud run jobs update nowrecommend-seed $P $R --image $IMG --command sh --args scripts/seed-job.sh
gcloud run jobs describe nowrecommend-seed $P $R --format="value(spec.template.spec.template.spec.containers[0].args)"   # scripts/seed-job.sh
gcloud run jobs execute nowrecommend-seed $P $R --wait
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="nowrecommend-seed"' $P --limit 20 --freshness 1h --format="value(timestamp,textPayload)"
```

- 확인: 로그에 다음이 보여야 합니다.
  - `migrate: at 0002; nothing to apply`
  - `contract migrations waiting: 0003`
  - `seed: … updated 16 …`: 음식 부제가 바뀝니다. 승인된 음악 파일이 바뀌지 않았으면 다른 항목은 unchanged입니다.
  - `embedded 16 items`
- 실패하면:
  - 마이그레이션·시드 단계 실패: 시드는 한 번에 커밋하므로 DB는 그대로입니다. 원인을 고친 뒤 다시 실행합니다.
  - 임베딩 실패(주로 Gemini 한도): API는 그대로 동작하고 음식 문장 유사도만 이전 값입니다. 나중에 작업을 다시 실행합니다.

**5) Pages 배포.** `main`에 push하면 Pages가 배포됩니다(`deploy-pages.yml`). 서버 테스트(`server-ci.yml`)도 함께 돕니다.

```bash
git push origin main
gh run list -R Ow-wL/NowRecommend --limit 2      # 두 워크플로가 success인지
```

- 확인:
  - 사이트에서 음식 카드에 "참고 가격"이 없어야 합니다.
  - "만원 이하 저녁"을 입력하면 추천 전에 "지원하지 않는 조건"이 보여야 합니다.
  - 개발자 도구 Network에 `/api/parse`·`/api/recommend`가 200이어야 합니다.
- 실패하면:
  - 워크플로가 실패하면 기존 사이트가 그대로 남습니다. 고친 뒤 새 커밋을 push합니다.
  - 새 화면에 문제가 있으면 `gh run rerun 40356928449 -R Ow-wL/NowRecommend`로 이전 화면을 다시 배포합니다. 그 상태에서는 위의 호환 기간과 같이 동작합니다.

**1단계 되돌리기 (DB 0002, 열과 값 그대로).**

1. `gcloud run services update-traffic nowrecommend-api $P $R --to-revisions nowrecommend-api-00006-hnk=100`
2. 시드 작업을 이전 설정으로 돌립니다. `gcloud run jobs update nowrecommend-seed $P $R --image asia-northeast3-docker.pkg.dev/harness-recommend/nowrecommend/api:c114929 --command sh --args=-c,"alembic upgrade head && python -m app.cli.seed && python -m app.cli.embed"`
3. 음식 부제·임베딩까지 이전 값으로 돌리려면 이 작업을 한 번 실행합니다. 또는 1)의 백업으로 복원합니다(`gcloud sql backups restore <BACKUP_ID> --restore-instance nowrecommend-db $P`). 복원은 DB 전체를 덮어씁니다.
4. 화면은 5)의 `gh run rerun`으로 되돌립니다.

### 0-4. 2단계: 가격 열 삭제 (옛 리비전이 완전히 빠진 뒤)

시작 조건:

- 호환 리비전이 트래픽 100%를 충분한 기간 받았어야 합니다.
- `nowrecommend-api-00005-l25`·`00006-hnk`로 되돌리지 않기로 정했어야 합니다.
- `gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.revision_name="nowrecommend-api-00006-hnk"' $P --freshness 1h --limit 1`이 비어 있어야 합니다.

```bash
gcloud sql backups create --instance nowrecommend-db $P --description "before price columns drop (0003)"
gcloud run jobs create nowrecommend-contract $P $R --image $IMG \
  --service-account nowrecommend-api@harness-recommend.iam.gserviceaccount.com --set-cloudsql-instances harness-recommend:asia-northeast3:nowrecommend-db \
  --set-secrets DATABASE_URL=database-url:latest --command python --args=-m,app.cli.migrate,--contract
gcloud run jobs execute nowrecommend-contract $P $R --wait
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="nowrecommend-contract"' $P --limit 10 --freshness 1h --format="value(timestamp,textPayload)"
```

- 확인:
  - 로그에 `migrate: at 0002; upgraded to 0003`이 보여야 합니다.
  - `/api/health`가 200이어야 합니다.
  - 사이트 추천이 정상이어야 합니다.
  - 새 API는 가격 열을 읽지 않으므로 다시 배포할 필요가 없습니다.
- 실패하면: 마이그레이션은 한 트랜잭션이라 DB는 0002 그대로입니다. 로그를 보고 고친 뒤 다시 실행합니다.
- 2단계를 마친 뒤 할 일: 해석 응답의 호환용 `maxPrice: null`(`server/app/routes/parse.py`)을 지우는 커밋을 따로 배포합니다.

**2단계 뒤 되돌리기.** 가격 제거 전 리비전은 DB가 0003이면 시작하지 못합니다. 0003을 모르는 `alembic upgrade head`가 실패하기 때문이며, 로컬에서 옛 이미지로 확인했습니다. 그래서 스키마부터 되돌립니다.

1. `gcloud sql backups create --instance nowrecommend-db $P`
2. `gcloud run jobs execute nowrecommend-contract $P $R --args=-m,app.cli.migrate,--downgrade,0002 --wait`: 열과 `items_price_backup`의 값이 돌아옵니다.
3. 0-3의 "1단계 되돌리기"를 따릅니다.

### 0-5. 검증한 것과 하지 않은 것

**로컬에서 확인한 것**

- `server/tests/test_migrations_db.py`가 별도 DB에서 다음 경로를 검사합니다.
  - 0002에서 호환 코드 실행: 0003이 대기하고, 옛 조회와 새 시드가 동작합니다.
  - `alembic upgrade head`를 그냥 실행하면 실패하고 DB는 바뀌지 않습니다.
  - 열 삭제 뒤 `alembic check`가 통과합니다.
  - 0002로 되돌리면 열과 값이 복원됩니다.
- 로컬 Docker 이미지로 다음을 실행했습니다.
  - 지금 시드 작업 명령을 새 이미지로 실행: 0003에서 멈추고 열·값이 그대로였습니다.
  - 새 시드 스크립트와 컨테이너 시작: 0003이 대기했습니다.
  - 옛 이미지는 DB가 0003이면 시작에 실패했습니다.
- 옛 화면(`7bc6a41`)을 새 API에 붙여 호환 기간 동작을 확인했습니다.

**하지 않은 것**

- 위 gcloud 명령을 운영에서 실행하지 않았습니다. 플래그가 있는지만 `--help`로 확인했습니다.
- 운영 DB의 마이그레이션 버전은 직접 조회하지 않았습니다.

`alembic check`(server-ci.yml)는 DB가 head일 때 하는 검사입니다. `items_price_backup`은 모델이 없는 운영용 표라 `app.models.UNMANAGED_TABLES`에 적어 비교에서 뺐습니다(`alembic/env.py`의 `include_object`). 운영용 표를 더 만들 때는 이 목록에 함께 적습니다.

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
| 데이터 작업 | Cloud Run 작업 `nowrecommend-seed` | 목표: `sh scripts/seed-job.sh`(확장 마이그레이션 → `app.cli.seed` → `app.cli.embed`). **지금 운영 설정은 `sh -c "alembic upgrade head && …"`이라 §0-3의 4)에서 이미지와 함께 바꿉니다** |
| 열 삭제 작업 | Cloud Run 작업 `nowrecommend-contract`(§0 2단계에서 만듦) | `python -m app.cli.migrate --contract` |
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

- 컨테이너는 시작할 때 `python -m app.cli.migrate`로 확장 마이그레이션만 적용합니다. 축소 마이그레이션은 §0 2단계처럼 따로 실행합니다.
- 환경 변수·비밀 값·Cloud SQL 연결은 이전 리비전 설정을 그대로 이어받습니다.

### 카탈로그를 바꿨을 때

`server/data/seed_items.json`을 바꿨거나, 승인한 AI 초안을 `python -m app.cli.review publish`로 `server/data/reviewed_items.json`에 내보내 커밋했다면 새 이미지를 만든 뒤 작업 이미지를 바꾸고 다시 실행합니다. 시드 작업은 두 파일을 차례로 넣고, 시드와 임베딩은 바뀐 항목만 처리합니다.

```bash
gcloud run jobs update nowrecommend-seed --project harness-recommend --region asia-northeast3 --image $IMG --command sh --args scripts/seed-job.sh
gcloud run jobs execute nowrecommend-seed --project harness-recommend --region asia-northeast3 --wait
```

`--command`·`--args`를 함께 주는 이유: 작업 명령이 아직 가격 제거 전 설정(`alembic upgrade head`)이면, 이미지만 바꿀 경우 0003에서 실패합니다(DB는 그대로). 한 번 바꾼 뒤에는 명령이 유지됩니다.

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
  - 가격 제거 **1단계만 마친 상태**(DB가 0002)라면 어느 리비전으로든 바로 되돌릴 수 있습니다.
  - **2단계까지 마친 상태**(DB가 0003)라면 바로 되돌려도 되는 대상은 가격 제거 이후 리비전뿐입니다. 이전 리비전(`nowrecommend-api-00005-l25`·`00006-hnk`)의 이미지는 0003을 모르므로 시작할 때 `alembic upgrade head`가 실패합니다. 그 리비전은 가격 열을 읽기도 합니다. 그래서 먼저 스키마를 되돌립니다.
    1. `gcloud sql backups create --project harness-recommend --instance nowrecommend-db`
    2. 가격 제거 이후 이미지로 `python -m app.cli.migrate --downgrade 0002`를 실행합니다. 예: `gcloud run jobs execute nowrecommend-contract --project harness-recommend --region asia-northeast3 --args=-m,app.cli.migrate,--downgrade,0002 --wait`. `items_price_backup`의 값으로 `price_label`·`cost`가 돌아옵니다.
    3. 그다음 위 명령으로 트래픽을 옮깁니다. 시드 작업도 옛 이미지로 돌리려면 작업 명령을 `alembic upgrade head`가 포함된 이전 설정으로 바꿉니다.
    4. 다시 앞으로 갈 때는 §0의 1·2단계를 처음부터 따릅니다.
- **전부 내리기**(비용을 멈출 때): 위처럼 오프라인 모드로 돌린 뒤 Cloud SQL 인스턴스와 Cloud Run 서비스를 삭제합니다. DB 삭제는 되돌릴 수 없지만, 카탈로그는 시드 파일로 다시 만들 수 있습니다.

## 4. 비용과 제한

- **비용**: GCP 무료 크레딧($300)에서 나갑니다. 고정비는 주로 Cloud SQL `db-f1-micro`로 월 약 $10 안팎(추정)입니다. Cloud Run·Artifact Registry·Secret Manager는 지금 사용량이면 무료 범위이거나 아주 적습니다. 실제 금액은 GCP 결제 화면에서 확인합니다.
- **Gemini 모델과 한도**: 코드 기본값 `gemini-3.6-flash`는 무료 등급에서 생성 요청이 분당 5회, 하루 20회라(R4 실측) 공개 시연에서는 금방 소진됩니다. 그래서 배포 서버는 `LLM_MODEL=gemini-3.5-flash-lite`를 씁니다. 2026-10-20 대표 10건 비교에서 Lite는 9건이 검증을 통과했고(1건 504), 고른 항목은 3.6과 비슷했지만 "평소 취향" 이유가 "새로운 취향" 위주로 약하고 조건 해석은 더 보수적이었습니다. 되돌리려면 `gcloud run services update nowrecommend-api --project harness-recommend --region asia-northeast3 --update-env-vars LLM_MODEL=gemini-3.6-flash`. 한도를 넘거나 모델이 10초 안에 답하지 않으면 결과가 `retrieval_only`(유사도 결과와 템플릿 이유)로 나옵니다. 키가 결제가 켜진 프로젝트에 속해 있으면 무료 한도 대신 요금이 청구될 수 있으니, AI Studio에서 키의 소속 프로젝트를 확인합니다.
- **백업 없음**: 서버 DB에는 카탈로그와 요청 로그만 있습니다. 사용자 취향·기록은 각 브라우저에 저장됩니다(결정 1).
- 키가 로그·화면·저장소에 노출되면 즉시 새 키를 만들고 `gcloud secrets versions add gemini-api-key --project harness-recommend --data-file=<파일>`로 바꾼 뒤 서비스를 다시 배포합니다.

## 5. 로컬 시연

```powershell
docker compose up -d --build
# 컨테이너는 확장 마이그레이션만 적용합니다. 로컬에서 0003(가격 열 삭제)까지 적용하려면 따로 실행합니다.
docker compose exec api python -m app.cli.migrate --contract
docker compose exec api python -m app.cli.seed
docker compose exec api python -m app.cli.embed
$env:VITE_API_BASE_URL = 'http://127.0.0.1:8010'
try { npm run dev } finally { Remove-Item Env:VITE_API_BASE_URL -ErrorAction SilentlyContinue }
```

브라우저는 `http://127.0.0.1:5173`으로 엽니다. 로컬 API의 CORS 허용 주소이기 때문입니다.
