# 지금 추천 — 배포 가이드

[plans-rag.md](./plans-rag.md) §12 결정 2의 정리입니다. 기본값은 **중간보고는 로컬 Docker 시연, 최종 공개 배포는 아래 구성 중 하나**입니다. 호스팅 업체의 요금·무료 범위는 배포 시점에 다시 확인해야 합니다. 이 문서는 특정 업체를 검증한 결과가 아닙니다.

## 1. 지금 바로 되는 것: 로컬 시연

```powershell
docker compose up -d --build
docker compose exec api python -m app.cli.seed
docker compose exec api python -m app.cli.embed
$env:VITE_API_BASE_URL = 'http://127.0.0.1:8010'
try { npm run dev } finally { Remove-Item Env:VITE_API_BASE_URL -ErrorAction SilentlyContinue }
```

- 브라우저는 `http://127.0.0.1:5173`으로 엽니다. API의 CORS 허용 주소이기 때문입니다.
- GitHub Pages 공개 사이트는 지금도 오프라인 모드(내장 카탈로그·브라우저 규칙)로 동작하며, 서버 없이도 시연할 수 있습니다.

## 2. 공개 배포 구성

프론트엔드는 계속 GitHub Pages를 씁니다. API와 DB만 따로 올립니다.

| 구성 | API | DB | 장점 | 주의 |
|---|---|---|---|---|
| A. 관리형 | `server/Dockerfile`을 그대로 쓰는 컨테이너 호스팅 | pgvector를 지원하는 관리형 PostgreSQL | 서버 관리가 적고 HTTPS가 기본 제공됨 | 무료 등급은 유휴 후 첫 요청이 느릴 수 있음. pgvector 확장 지원 여부를 먼저 확인 |
| B. 단일 VM | `docker compose` 그대로 + 리버스 프록시(자동 HTTPS) | 같은 VM의 `pgvector/pgvector:pg17` | 지금 로컬 구성과 같아 옮기기 쉬움 | OS 보안 업데이트·백업을 직접 관리 |

어느 구성이든 API는 **한 인스턴스**로 시작합니다. 요청 제한·쿨다운·캐시가 프로세스 메모리에 있어서, 여러 인스턴스로 늘리면 인스턴스마다 따로 셉니다.

## 3. 배포 체크리스트

1. **API는 HTTPS 주소여야 합니다.** Pages가 https라서 http API 호출은 브라우저가 막습니다(mixed content).
2. API 환경 변수:
   - `DATABASE_URL`: 관리형 DB 주소. `postgresql+psycopg://` 형식입니다.
   - `GEMINI_API_KEY`: 호스팅의 비밀 값으로만 넣습니다. 프론트엔드·저장소에는 넣지 않습니다.
   - `CORS_ORIGINS='["https://ow-wl.github.io"]'`: origin에는 경로가 없습니다(`/NowRecommend` 제외).
   - `LOG_RAW_TEXT=false`: 배포 환경에서는 입력 문장 원문을 저장하지 않습니다(결정 4).
   - `TRUST_PROXY=true`: 프록시·로드밸런서 뒤에 둘 때 설정합니다. 이렇게 해야 요청 제한이 실제 사용자 IP 기준이 됩니다.
   - `RATE_LIMIT_PER_MINUTE`: 기본 30입니다.
3. DB 준비: 컨테이너는 시작할 때 `alembic upgrade head`를 실행합니다. 처음 한 번은 `python -m app.cli.seed`와 `python -m app.cli.embed`를 실행합니다.
4. 상태 확인: `GET /api/health`는 DB와 pgvector가 준비되면 200, 아니면 503을 반환합니다. 호스팅의 health check 경로로 지정합니다.
5. Pages 연결: 저장소 Settings → Secrets and variables → Actions → **Variables**에 `VITE_API_BASE_URL=https://<API 주소>`를 추가하고 Pages 배포 워크플로를 다시 실행합니다. 비밀 값이 아니라 공개 주소라 Variables에 넣습니다.
6. 확인 순서:
   - API `curl https://<API>/api/health`
   - Pages에서 개발자 도구 Network로 `/api/catalog`·`/api/recommend` 요청 확인
   - 서버를 끈 상태에서 "기본 추천으로 보기" 동작 확인
7. 되돌리기: `VITE_API_BASE_URL` 변수를 지우고 다시 배포하면 즉시 오프라인 모드로 돌아갑니다.

## 4. 알아둘 제한

- **Gemini 무료 등급 한도**: 생성 요청이 분당 5회, 하루 20회입니다(R4 실측). 공개 시연에서는 대부분 `retrieval_only`(유사도 결과·템플릿 이유)로 응답하게 됩니다. AI 재순위를 보여주려면 결제 등록이나 모델 변경을 결정해야 합니다(결정 5).
- 서버 쪽 사용자 계정·기록 저장은 없습니다. 취향·기록은 지금처럼 각 브라우저에 저장됩니다(결정 1).
- 키가 로그·화면·저장소에 노출되면 즉시 새 키로 교체합니다.
