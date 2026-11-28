"""The admin-rights lock on PostgreSQL (2026-11-29): a rights change holds it alone and every admin change holds it shared,
so a change waits for a revoke that is under way and then sees it. SQLite has no such lock, hence a real database here."""
import threading
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, delete
from sqlalchemy.orm import sessionmaker

from app.auth import hash_password
from app.models import User
from app.routes.reports import admin_rights_lock, require_admin_write
from tests.conftest import needs_db

pytestmark = needs_db


@pytest.fixture
def make(test_database_url):
    engine = create_engine(test_database_url)
    make = sessionmaker(engine, expire_on_commit=False)
    made = []

    def admin(email):
        with make() as s:
            user = User(email=f"{uuid.uuid4().hex[:8]}-{email}", name="관리자", password_hash=hash_password("password1"), is_admin=True)
            s.add(user)
            s.commit()
            made.append(user.id)
            return user

    yield make, admin
    with make() as s:
        s.execute(delete(User).where(User.id.in_(made)))
        s.commit()
    engine.dispose()


def run(target):
    """Runs `target` in a thread; returns (thread, box) where box gets ("ok", value) or ("refused", status)."""
    box = []

    def body():
        try:
            box.append(("ok", target()))
        except HTTPException as error:
            box.append(("refused", error.status_code))

    thread = threading.Thread(target=body)
    thread.start()
    return thread, box


def test_a_change_waits_for_a_revoke_under_way_and_then_sees_it(make):
    make, admin = make
    other = admin("op@example.com")
    with make() as revoking, make() as writing:
        admin_rights_lock(revoking, alone=True)           # the owner's revoke has started
        seen = writing.get(User, other.id)                # what require_admin saw just before
        thread, box = run(lambda: require_admin_write(seen, writing).id)
        thread.join(1.5)
        assert thread.is_alive() and not box              # waiting on the rights lock, not deciding on old rights
        revoking.get(User, other.id, with_for_update=True).is_admin = False
        revoking.commit()                                 # the revoke ends; the lock goes with the transaction
        thread.join(10)
        assert box == [("refused", 403)]


def test_admin_changes_do_not_wait_for_each_other(make):
    make, admin = make
    first, second = admin("a@example.com"), admin("b@example.com")
    with make() as one, make() as two:
        assert require_admin_write(one.get(User, first.id), one).id == first.id  # holds the lock shared, not committed
        thread, box = run(lambda: require_admin_write(two.get(User, second.id), two).id)
        thread.join(5)
        assert box == [("ok", second.id)]
        one.rollback()
        two.rollback()
