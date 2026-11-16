"""The version of the terms and privacy policy in force, and the service's minimum age (shared/legal.json).

One file for the frontend (src/legal.ts shows the documents and names the version on the sign-up form) and the server
(which accepts a sign-up only for the version in force and records it), so the two cannot drift apart.
"""
import json
from dataclasses import dataclass
from functools import lru_cache

from .config import get_settings


@dataclass(frozen=True)
class Legal:
    version: str
    min_age: int


@lru_cache
def get_legal() -> Legal:
    data = json.loads(get_settings().legal_path.read_text(encoding="utf-8"))
    return Legal(version=str(data["version"]), min_age=int(data["minAge"]))
