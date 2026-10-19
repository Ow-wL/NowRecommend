"""Single place that talks to the Gemini generation API.

gemini-3.6-flash ignores temperature (plans-rag.md §3), so output stability comes from the system
instruction, a JSON schema and server-side validation; variety comes from the retrieval τ instead.
"""
import json
import re
import time
from typing import Protocol


class JsonModel(Protocol):
    model: str

    def generate_json(self, system: str, payload: dict, schema: dict) -> dict: ...


class GeminiJsonModel:
    def __init__(self, api_key: str, model: str, timeout_ms: int = 10000, thinking_level: str = "low", client=None):
        if client is None:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=timeout_ms))
        self.client, self.model, self.thinking_level = client, model, thinking_level

    def generate_json(self, system: str, payload: dict, schema: dict) -> dict:
        from google.genai import types

        response = self.client.models.generate_content(
            model=self.model,
            # The request is data for the model, never instructions; the system instruction says so too.
            contents=json.dumps(payload, ensure_ascii=False),
            config=types.GenerateContentConfig(
                system_instruction=system,
                response_mime_type="application/json",
                response_json_schema=schema,
                thinking_config=types.ThinkingConfig(thinking_level=self.thinking_level),
            ),
        )
        value = json.loads(response.text or "")
        if not isinstance(value, dict):
            raise ValueError("model returned non-object JSON")
        return value


class CoolingDown(RuntimeError):
    """Raised instead of calling the model while a 429/503 back-off is in effect."""


class CooldownModel:
    """Skips model calls after quota (429) or overload (503) answers, for the delay the API asks for.

    The free tier allows only a few generate requests (R4: 5/min and 20/day for gemini-3.6-flash);
    without this every request in that window would wait for a refusal before falling back.
    """

    def __init__(self, inner: JsonModel, clock=time.monotonic, default_429: float = 30.0, default_503: float = 10.0):
        self.inner, self.clock, self.default_429, self.default_503 = inner, clock, default_429, default_503
        self.model = inner.model
        self.until = 0.0

    def generate_json(self, system: str, payload: dict, schema: dict) -> dict:
        if self.clock() < self.until:
            raise CoolingDown(f"retry after {self.until - self.clock():.0f}s")
        try:
            return self.inner.generate_json(system, payload, schema)
        except Exception as exc:
            code = getattr(exc, "code", None)
            if code == 429:
                self.until = self.clock() + retry_delay(str(exc), self.default_429)
            elif code == 503:
                self.until = self.clock() + self.default_503
            raise


MAX_COOLDOWN = 3600.0  # a spent daily quota asks for ~20h; re-probing hourly is cheap and recovers sooner


def retry_delay(message: str, default: float) -> float:
    """Delay from the error's RetryInfo ('retryDelay': '69554s') or text ('retry in 19h19m14.8s')."""
    if match := re.search(r"retryDelay['\"]?\s*:\s*['\"]([\d.]+)s", message):
        seconds = float(match.group(1))
    elif match := re.search(r"retry in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?", message):
        hours, minutes, secs = (float(g) if g else 0.0 for g in match.groups())
        seconds = hours * 3600 + minutes * 60 + secs
    else:
        seconds = 0.0
    return min(seconds, MAX_COOLDOWN) if seconds > 0 else default
