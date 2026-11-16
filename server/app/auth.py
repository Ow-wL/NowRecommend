"""Accounts: password hashing and signed session tokens, standard library only.

Passwords use PBKDF2-HMAC-SHA256 with a per-user salt. Tokens are `base64url(payload).base64url(hmac)` signed with
AUTH_SECRET; the payload carries the user id, the account's token version and an expiry, so the server keeps no session
table. Raising one account's token version signs that account out everywhere; rotating the secret signs everyone out.
"""
import base64
import hashlib
import hmac
import json
import os
import re
import time
from collections.abc import Callable
from dataclasses import dataclass

PBKDF2_ITERATIONS = 310_000
SALT_BYTES = 16
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def hash_password(password: str, iterations: int = PBKDF2_ITERATIONS) -> str:
    salt = os.urandom(SALT_BYTES)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, iterations, salt, digest = stored.split("$")
        if scheme != "pbkdf2_sha256":
            return False
        expected = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), _unb64(salt), int(iterations))
        return hmac.compare_digest(expected, _unb64(digest))
    except (ValueError, TypeError):
        return False


def normalize_email(email: str) -> str:
    return email.strip().lower()


def valid_email(email: str) -> bool:
    return len(email) <= 254 and EMAIL.match(email) is not None


@dataclass(frozen=True)
class TokenSigner:
    """Signs two kinds of token. A session token names the account and its `token_version`: raising that number on the
    account (a new password, "sign out everywhere") ends every token issued before. A reset token is good for one
    password change: it carries a fingerprint of the password hash it was issued for, so it dies with that password."""
    secret: str
    ttl_seconds: int = 30 * 24 * 3600
    now: Callable[[], float] = time.time

    def issue(self, user_id: str, version: int = 0) -> str:
        return self._token({"sub": user_id, "ver": version, "exp": int(self.now()) + self.ttl_seconds})

    def session(self, token: str) -> tuple[str, int] | None:
        """(account id, token version) of a valid session token. A token from before versions counts as version 0."""
        data = self._claims(token)
        if data is None or "use" in data or not isinstance(data.get("ver", 0), int):
            return None
        return data["sub"], data.get("ver", 0)

    def verify(self, token: str) -> str | None:
        """The account id of a validly signed, unexpired session token; None for anything else (never raises on garbage).
        Signature only: whether the account still accepts the token is the caller's question (routes/auth.py)."""
        claims = self.session(token)
        return claims[0] if claims else None

    def issue_reset(self, user_id: str, password_hash: str, ttl_seconds: int = 1800) -> str:
        return self._token({"sub": user_id, "use": "reset", "pw": self.fingerprint(password_hash), "exp": int(self.now()) + ttl_seconds})

    def reset(self, token: str) -> tuple[str, str] | None:
        """(account id, password fingerprint) of a valid reset token."""
        data = self._claims(token)
        if data is None or data.get("use") != "reset" or not isinstance(data.get("pw"), str):
            return None
        return data["sub"], data["pw"]

    def fingerprint(self, password_hash: str) -> str:
        """Tells whether a password hash is still the one a reset token was issued for, without putting the hash in the token."""
        return _b64(hmac.new(self.secret.encode("utf-8"), f"reset|{password_hash}".encode("utf-8"), hashlib.sha256).digest())[:22]

    def _token(self, data: dict) -> str:
        payload = _b64(json.dumps(data, separators=(",", ":")).encode())
        return f"{payload}.{self._sign(payload)}"

    def _claims(self, token: str) -> dict | None:
        try:
            payload, signature = token.split(".")
            if not hmac.compare_digest(self._sign(payload), signature):
                return None
            data = json.loads(_unb64(payload))
            if not isinstance(data, dict) or not isinstance(data.get("sub"), str) or not isinstance(data.get("exp"), int) or data["exp"] < self.now():
                return None
            return data
        except (ValueError, TypeError, AttributeError):
            return None

    def _sign(self, payload: str) -> str:
        return _b64(hmac.new(self.secret.encode("utf-8"), payload.encode("ascii"), hashlib.sha256).digest())


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
