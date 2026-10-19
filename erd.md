# 지금 추천 — ERD

## 현재 구현 (plans-rag.md R1)

음식·음악을 통합 `ITEMS` 테이블에 저장합니다. 태그는 별도 테이블 대신 `shared/vocab.json` 어휘로 검증한 `text[]`로 둡니다. 실제 정의는 `server/alembic/versions/0001_items_and_logs.py`에 있습니다.

```mermaid
erDiagram

    ITEMS {
        text id PK "기존 f01·m01 유지"
        text category "food | music"
        text name
        text artist "음악만"
        text subtitle
        text description
        text_array tags "vocab.json 어휘"
        text_array ingredients
        text price_label
        int cost "필터용 기준 가격"
        text emoji
        text color
        text status "draft | reviewed | rejected"
        text source "seed | ai_draft | user_request"
        text_array ai_fields "AI가 채운 필드"
        vector768 embedding
        text embedding_model
        text embedding_hash
        timestamptz created_at
        timestamptz updated_at
        timestamptz reviewed_at
    }

    RECOMMENDATION_LOGS {
        uuid id PK
        timestamptz created_at
        text category
        text raw_text
        jsonb conditions
        jsonb params "가중치·탐색 온도·모델"
        text_array candidate_ids
        jsonb candidate_scores
        text_array result_ids
        text mode "rag | retrieval_only"
        int latency_ms
        text error
    }
```

- `RECOMMENDATION_LOGS`의 ID 배열은 `ITEMS.id`를 가리키지만, 항목이 바뀌거나 내려가도 로그가 남도록 외래 키를 두지 않습니다.
- 고유 인덱스 `(category, lower(name), coalesce(lower(artist), ''))`로 같은 메뉴·곡의 중복 등록을 막습니다.

## 후속 단계 — 계정 도입 시 (plans-rag.md §12 결정 1)

현재 취향·즐겨찾기·기록은 브라우저 저장소에 있습니다. 계정을 도입하면 아래 테이블을 추가하고 모두 `ITEMS`를 참조합니다.

```mermaid
erDiagram

    USERS {
        uuid id PK
        varchar email
        varchar password_hash
        varchar name
        timestamp created_at
    }

    USER_ITEM_PREFERENCES {
        uuid user_id FK
        text item_id FK
        varchar preference_type "selected | disliked"
    }

    USER_TAG_PREFERENCES {
        uuid user_id FK
        varchar category
        varchar tag
    }

    FAVORITES {
        uuid user_id FK
        text item_id FK
        timestamp created_at
    }

    RECOMMENDATION_SESSIONS {
        uuid id PK
        uuid user_id FK
        varchar category
        text input_text
        jsonb conditions
        timestamp created_at
    }

    RECOMMENDATION_RESULTS {
        bigint id PK
        uuid session_id FK
        text item_id
        int rank
        decimal score
        text taste_reason
        text context_reason
    }

    ITEMS {
        text id PK
    }

    USERS ||--o{ USER_ITEM_PREFERENCES : has
    USERS ||--o{ USER_TAG_PREFERENCES : has
    USERS ||--o{ FAVORITES : saves
    USERS ||--o{ RECOMMENDATION_SESSIONS : creates
    ITEMS ||--o{ USER_ITEM_PREFERENCES : preference
    ITEMS ||--o{ FAVORITES : saved
    RECOMMENDATION_SESSIONS ||--o{ RECOMMENDATION_RESULTS : produces
```
