from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from app.schemas import YearRange

NOW = datetime.now(timezone(timedelta(hours=9))).year


def test_a_range_past_this_year_ends_at_this_year():
    years = YearRange.model_validate({"from": 2020, "to": NOW + 3})
    assert (years.start, years.end) == (2020, NOW)


def test_a_range_that_starts_after_this_year_is_refused():
    for body in ({"from": NOW + 1}, {"from": NOW + 4, "to": NOW + 4}):
        with pytest.raises(ValidationError, match="올해"):
            YearRange.model_validate(body)


def test_this_year_and_earlier_pass_unchanged():
    years = YearRange.model_validate({"from": NOW, "to": NOW})
    assert (years.start, years.end) == (NOW, NOW)
    assert YearRange.model_validate({"to": 2000}).end == 2000
