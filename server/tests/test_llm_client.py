import json
from types import SimpleNamespace

import pytest

from app.llm.client import CooldownModel, CoolingDown, GeminiJsonModel, retry_delay


class ApiError(Exception):
    def __init__(self, code, message=""):
        super().__init__(message)
        self.code = code


class Inner:
    model = "inner"

    def __init__(self, *errors):
        self.errors, self.calls = list(errors), 0

    def generate_json(self, system, payload, schema):
        self.calls += 1
        if self.errors:
            raise self.errors.pop(0)
        return {"picks": []}


class Clock:
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now


def test_quota_refusal_pauses_calls_for_the_requested_delay():
    clock, inner = Clock(), Inner(ApiError(429, "Quota exceeded ... Please retry in 21.86s."))
    model = CooldownModel(inner, clock=clock)
    with pytest.raises(ApiError):
        model.generate_json("s", {}, {})
    clock.now += 21
    with pytest.raises(CoolingDown):
        model.generate_json("s", {}, {})
    assert inner.calls == 1
    clock.now += 1
    assert model.generate_json("s", {}, {}) == {"picks": []} and inner.calls == 2


def test_overload_pauses_briefly_and_other_errors_do_not_pause():
    clock = Clock()
    model = CooldownModel(Inner(ApiError(503), ApiError(400), TimeoutError()), clock=clock, default_503=10)
    with pytest.raises(ApiError):
        model.generate_json("s", {}, {})
    clock.now += 10
    for error in (ApiError, TimeoutError):
        with pytest.raises(error):
            model.generate_json("s", {}, {})
    assert model.generate_json("s", {}, {}) == {"picks": []}


def test_retry_delay_parsing_is_bounded():
    assert retry_delay("Please retry in 21.866397459s.", 30) == pytest.approx(21.866, abs=1e-3)
    assert retry_delay("Please retry in 2m5s.", 30) == 125
    # Spent daily quota (seen in R4): both forms are read, and the pause is capped at an hour.
    daily = "Please retry in 19h19m14.79s.', ... {'@type': 'type.googleapis.com/google.rpc.RetryInfo', 'retryDelay': '69554s'}"
    assert retry_delay(daily, 30) == 3600
    assert retry_delay("retry in 19h19m14.79s", 30) == 3600
    assert retry_delay("{'retryDelay': '45s'}", 30) == 45
    assert retry_delay("no hint", 30) == 30


class FakeModels:
    def __init__(self, text):
        self.text, self.calls = text, []

    def generate_content(self, model, contents, config):
        self.calls.append((model, contents, config))
        return SimpleNamespace(text=self.text)


def test_gemini_model_sends_payload_as_json_with_schema():
    models = FakeModels('{"picks": [{"id": "f01"}]}')
    model = GeminiJsonModel("k", "gemini-3.6-flash", client=SimpleNamespace(models=models))
    assert model.generate_json("규칙", {"situation": "담백한 저녁"}, {"type": "object"}) == {"picks": [{"id": "f01"}]}
    name, contents, config = models.calls[0]
    assert name == "gemini-3.6-flash" and json.loads(contents) == {"situation": "담백한 저녁"}
    assert config.system_instruction == "규칙" and config.response_json_schema == {"type": "object"}
    assert config.response_mime_type == "application/json" and config.thinking_config.thinking_level.value == "LOW"
    assert config.temperature is None  # ignored by gemini-3.6-flash, so never sent


def test_gemini_model_rejects_non_object_answers():
    for text in ("[]", "not json", ""):
        with pytest.raises(ValueError):
            GeminiJsonModel("k", "m", client=SimpleNamespace(models=FakeModels(text))).generate_json("s", {}, {})
