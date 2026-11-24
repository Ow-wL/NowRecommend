from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# server/app/config.py → project root holds shared/vocab.json (same layout inside Docker).
PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+psycopg://nowrecommend:nowrecommend@127.0.0.1:5433/nowrecommend"
    cors_origins: list[str] = ["http://127.0.0.1:5173", "http://localhost:5173", "https://ow-wl.github.io"]
    vocab_path: Path = PROJECT_ROOT / "shared" / "vocab.json"
    gemini_api_key: str | None = None
    embedding_model: str = "gemini-embedding-2"
    embedding_dim: int = 768  # must equal the vector(768) column
    llm_model: str = "gemini-3.6-flash"
    rerank_enabled: bool = True
    # How POST /api/recommend answers music (2026-11-02, after the lab comparison): "ai" = the model names songs from its
    # own knowledge (llm/free.py), falling back to the catalog pipeline when it fails; "catalog" = the pipeline only.
    music_engine: str = "ai"
    # The same choice for food (2026-11-03): the model names detail menus; exclusions are checked against the ingredients it lists.
    food_engine: str = "ai"
    # The AI engine asks Apple's store whether its songs are listed and shows the listed ones first (song_store.py, 2026-11-10).
    # The store allows about 20 requests a minute per address; past the budget or the deadline the songs keep the model's order.
    song_store_check: bool = True
    song_store_per_minute: int = Field(18, ge=0)
    song_store_deadline_ms: int = Field(1500, ge=100)
    # A song's YouTube video for the player in its details (youtube.py, 2026-11-18). Without the key the player is not offered.
    # The API allows 100 searches a day, reset at midnight Pacific time (16:00 or 17:00 in Korea). The service counts its own
    # day in KST, and one Pacific day spans two of those, so half of 100 keeps it under: at most `youtube_daily_limit` a day,
    # one address at most `youtube_daily_per_address`. A song asked again within a week answers from memory, uncounted.
    youtube_api_key: str | None = None
    youtube_daily_limit: int = Field(50, ge=0)
    youtube_daily_per_address: int = Field(10, ge=0)  # 0: no limit per address (the day's limit still holds; 0 there turns the player off)
    parse_enabled: bool = True  # LLM parsing, only for words the rule parser missed
    # The Gemini API rejects request deadlines under 10s with 400 INVALID_ARGUMENT (seen in R4).
    rerank_timeout_ms: int = Field(10000, ge=10000)
    db_connect_timeout: int = 3
    # Store request sentences in recommendation_logs. Off unless turned on for a local evaluation: the privacy policy
    # says the sentence is not kept (src/legal.ts), and that must not hang on someone remembering a deploy setting.
    log_raw_text: bool = False
    # POSTs to /api/recommend and /api/parse per client per minute (0 = off); TRUST_PROXY reads X-Forwarded-For.
    rate_limit_per_minute: int = 30
    # The same limit for a visitor who is not signed in (0 = the limit above). A signed-in caller is counted per account,
    # a guest per address.
    rate_limit_guest_per_minute: int = 15
    # Daily limits kept in the database (app/budget.py; the day is Korean time; 0 = off). AI_DAILY_LIMIT: model calls of
    # the whole service, the ceiling on the bill. Past it, and past a caller's own allowance, answers come from the
    # catalog and the rules, as they do when the model fails.
    ai_daily_limit: int = 3000
    ai_daily_per_member: int = 100
    ai_daily_per_guest: int = 40
    signup_daily_per_address: int = 20
    # Sign-up needs the agreed terms version and the age confirmation the form sends (2026-11-17). False only for a
    # short deploy window with an older frontend still in browsers; the account is then stored without a consent record.
    signup_consent_required: bool = True
    legal_path: Path = PROJECT_ROOT / "shared" / "legal.json"  # the documents' version and the service's age, shared with the frontend
    trust_proxy: bool = False
    # Accounts (2026-11-02). Without AUTH_SECRET the auth routes answer 503 and the app stays guest-only. Rotating the
    # secret signs every account out. Generate one with: python -c "import secrets; print(secrets.token_urlsafe(48))"
    auth_secret: str | None = None
    auth_token_days: int = 30
    # Outgoing mail for the password reset link (app/mail.py). Without SMTP_HOST and MAIL_FROM the reset routes answer 503.
    # Port 465 is TLS from the start; any other port must offer STARTTLS. MAIL_FROM: "지금 추천 <no-reply@example.com>".
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    mail_from: str | None = None
    # Where the app is served: the reset link in the mail opens <PUBLIC_APP_URL>#/reset/<token>.
    public_app_url: str = "https://ow-wl.github.io/NowRecommend/"
    reset_token_minutes: int = 30
    # Sign-up confirms the address by mail before the account signs in (routes/auth.py, 2026-11-18). Off by default so
    # local runs and tests need no mail server; production sets EMAIL_VERIFICATION=true. Confirmation mails: per address
    # and per account like the reset mails, and at most `verify_daily_total` a day for the whole service. With the reset
    # mails' total (50) that stays under the mail service's free 100 a day.
    email_verification: bool = False
    verify_link_hours: int = 24
    verify_daily_per_address: int = 3  # 10 → 3 (security review 2026-11-24): four addresses used the whole day's 40
    verify_daily_per_email: int = 3
    verify_daily_total: int = 40
    # An account never confirmed (and never signed in, holding nothing) is removed this many days after it was made, plus
    # the life of a link, so a link mailed on the last day still finds it (retention.py).
    unverified_keep_days: int = 7
    feedback_daily_per_address: int = 10
    feedback_daily_total: int = 200
    # Where the daily count of new feedback and error reports goes (digest.py, 2026-11-23). Empty: no mail.
    feedback_digest_to: str = ""
    # What one place may add to the dashboard's counts in a day (POST /api/stats, routes/stats.py).
    stats_daily_per_address: int = 50
    # Reset mails per day (Korean day; 0 = off): from one address, and to one account, so nobody's inbox can be flooded.
    reset_daily_per_address: int = 3  # 10 → 3, as for the confirmation mails (2026-11-24)
    reset_daily_per_email: int = 3
    # Reset mails of the whole service per day (0 = off). The mail service's free plan sends 100 a day (2026-11-17): past
    # this the form still answers the same and no mail leaves, so one day's flood cannot use the plan up or get the
    # sender's domain marked as a spammer.
    reset_daily_total: int = 50
    # Wrong passwords per hour (0 = off; routes/auth.py login_attempt). For one account from one address: someone guessing
    # is stopped for the hour, and the owner at another address is not. A signed-in session trying the current password
    # (change, delete) has the same number, counted apart.
    login_fails_per_hour: int = 10
    # For one account from every address together: guesses spread over many addresses stop too. Only at this number do
    # all logins for the account wait for the next hour; signed-in sessions go on and a mailed reset link gets in.
    login_fails_per_hour_any: int = 100
    # From one address over every account together (2026-11-24): one common password tried once at each of many accounts
    # was stopped by neither count above.
    login_fails_per_hour_address: int = 30
    # Error reports per day (POST /api/reports, 2026-11-24): from one address, and for the whole service.
    report_daily_per_address: int = 20
    report_daily_total: int = 500
    # Largest synced browser store accepted by PUT /api/me/store (backups cap at 5MB in the browser; 1MB ≈ 50 entries with rounds).
    store_max_bytes: int = 1_000_000
    # PUT /api/me/store per client per minute (0 = off). The browser waits 1.5s after a change, so 40 is its own ceiling.
    store_writes_per_minute: int = 60


@lru_cache
def get_settings() -> Settings:
    return Settings()
