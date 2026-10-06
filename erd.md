```mermaid
erDiagram

    USERS {
        uuid id PK
        varchar email
        varchar password_hash
        varchar name
        varchar role
        timestamp created_at
    }

    FOOD_ITEMS {
        bigint id PK
        varchar name
        text description
        int price
        varchar status
    }

    MUSIC_TRACKS {
        bigint id PK
        varchar title
        bigint artist_id FK
        varchar external_url
        varchar status
    }

    ARTISTS {
        bigint id PK
        varchar name
    }

    TAGS {
        bigint id PK
        varchar domain
        varchar name
    }

    FOOD_ITEM_TAGS {
        bigint food_item_id FK
        bigint tag_id FK
    }

    MUSIC_TRACK_TAGS {
        bigint music_track_id FK
        bigint tag_id FK
    }

    USER_FOOD_PREFERENCES {
        uuid user_id FK
        bigint food_item_id FK
        varchar preference_type
    }

    USER_MUSIC_PREFERENCES {
        uuid user_id FK
        bigint music_track_id FK
        varchar preference_type
    }

    USER_TAG_PREFERENCES {
        uuid user_id FK
        bigint tag_id FK
        varchar preference_type
    }

    RECOMMENDATION_SESSIONS {
        uuid id PK
        uuid user_id FK
        varchar domain
        text input_text
        int max_price
        timestamp created_at
    }

    SESSION_TAGS {
        uuid session_id FK
        bigint tag_id FK
        varchar condition_type
    }

    RECOMMENDATION_RESULTS {
        bigint id PK
        uuid session_id FK
        varchar item_type
        bigint item_id
        int rank
        decimal score
        text taste_reason
        text context_reason
    }

    FOOD_FAVORITES {
        uuid user_id FK
        bigint food_item_id FK
    }

    MUSIC_FAVORITES {
        uuid user_id FK
        bigint music_track_id FK
    }


    USERS ||--o{ USER_FOOD_PREFERENCES : has
    USERS ||--o{ USER_MUSIC_PREFERENCES : has
    USERS ||--o{ USER_TAG_PREFERENCES : has

    USERS ||--o{ RECOMMENDATION_SESSIONS : creates

    FOOD_ITEMS ||--o{ FOOD_ITEM_TAGS : has
    TAGS ||--o{ FOOD_ITEM_TAGS : classifies

    MUSIC_TRACKS ||--o{ MUSIC_TRACK_TAGS : has
    TAGS ||--o{ MUSIC_TRACK_TAGS : classifies

    ARTISTS ||--o{ MUSIC_TRACKS : performs

    RECOMMENDATION_SESSIONS ||--o{ SESSION_TAGS : has
    TAGS ||--o{ SESSION_TAGS : used_as_condition

    RECOMMENDATION_SESSIONS ||--o{ RECOMMENDATION_RESULTS : produces

    USERS ||--o{ FOOD_FAVORITES : saves
    FOOD_ITEMS ||--o{ FOOD_FAVORITES : saved

    USERS ||--o{ MUSIC_FAVORITES : saves
    MUSIC_TRACKS ||--o{ MUSIC_FAVORITES : saved

    FOOD_ITEMS ||--o{ USER_FOOD_PREFERENCES : preference
    MUSIC_TRACKS ||--o{ USER_MUSIC_PREFERENCES : preference
    TAGS ||--o{ USER_TAG_PREFERENCES : preference