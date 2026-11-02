"""Accounts: password hashing and signed session tokens, standard library only.

Passwords use PBKDF2-HMAC-SHA256 with a per-user salt. Tokens are `base64url(payload).base64url(hmac)` signed with
AUTH_SECRET; the payload carries the user id and an expiry, so the server keeps no session table. Rotating the secret
signs everyone out, which is the intended way to revoke every token at once.
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
    secret: str
    ttl_seconds: int = 30 * 24 * 3600
    now: Callable[[], float] = time.time

    def issue(self, user_id: str) -> str:
        payload = _b64(json.dumps({"sub": user_id, "exp": int(self.now()) + self.ttl_seconds}, separators=(",", ":")).encode())
        return f"{payload}.{self._sign(payload)}"

    def verify(self, token: str) -> str | None:
        """The user id of a valid, unexpired token; None for anything else (never raises on garbage)."""
        try:
            payload, signature = token.split(".")
            if not hmac.compare_digest(self._sign(payload), signature):
                return None
            data = json.loads(_unb64(payload))
            if not isinstance(data.get("sub"), str) or not isinstance(data.get("exp"), int) or data["exp"] < self.now():
                return None
            return data["sub"]
        except (ValueError, TypeError, AttributeError):
            return None

    def _sign(self, payload: str) -> str:
        return _b64(hmac.new(self.secret.encode("utf-8"), payload.encode("ascii"), hashlib.sha256).digest())


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
