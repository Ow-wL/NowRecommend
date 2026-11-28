"""Admin rights from the console (2026-11-26): only the owner account (ADMIN_OWNER_ID), only with its password typed again,
a grant ends the member's earlier tokens, a revoke ends the console at once, and every change is in the action record."""
from datetime import datetime, timezone

from sqlalchemy import select

from app.cli import admin as cli
from app.config import get_settings
from app.models import AdminAudit, User

from tests.test_admin_console import bearer, person, settings, world  # noqa: F401 - the fixture is used by name


def owned(client, owner):
    client.app.dependency_overrides[get_settings] = lambda: settings(admin_owner_id=str(owner.id))


def change(client, signer, owner, member, version=0, **body):
    body = {"grant": True, "reason": "운영 도움", "password": "password1", **body}
    return client.post(f"/api/admin/members/{member.id}/admin", json=body, headers=bearer(signer, owner, version))


def test_the_owner_grants_and_revokes_with_its_password_and_it_is_recorded(world):
    client, _, make, signer = world
    owner, member = person(make, "owner@example.com", admin=True), person(make, "lee@example.com")
    owned(client, owner)
    details = client.get(f"/api/admin/members/{member.id}", headers=bearer(signer, owner)).json()
    assert details["canSetAdmin"] is True and details["owner"] is False
    assert change(client, signer, owner, member, password="wrong-one").status_code == 401
    answer = change(client, signer, owner, member)
    assert answer.status_code == 200 and answer.json()["isAdmin"] is True
    # A token from before the grant is not an admin token: the member signs in again.
    assert client.get("/api/admin/overview", headers=bearer(signer, member, 0)).status_code == 401
    assert client.get("/api/admin/overview", headers=bearer(signer, member, 1)).status_code == 200
    assert change(client, signer, owner, member).status_code == 409  # already one
    answer = change(client, signer, owner, member, grant=False)
    assert answer.status_code == 200 and answer.json()["isAdmin"] is False
    assert client.get("/api/admin/overview", headers=bearer(signer, member, 1)).status_code == 403  # the console ends now
    assert client.get("/api/auth/me", headers=bearer(signer, member, 1)).status_code == 200      # the sign-in does not
    with make() as s:
        actions = [(a.action, a.reason, a.detail["who"]) for a in s.scalars(select(AdminAudit).where(AdminAudit.action.like("%_admin")).order_by(AdminAudit.id))]
    assert actions == [("grant_admin", "운영 도움", "le*@example.com"), ("revoke_admin", "운영 도움", "le*@example.com")]


def test_a_revoke_can_end_every_sign_in_too(world):
    client, _, make, signer = world
    owner, other = person(make, "owner@example.com", admin=True), person(make, "op@example.com", admin=True)
    owned(client, owner)
    assert change(client, signer, owner, other, grant=False, endSessions=True).status_code == 200
    assert client.get("/api/auth/me", headers=bearer(signer, other, 0)).status_code == 401


def test_nobody_else_changes_admin_rights(world):
    client, _, make, signer = world
    owner, other, member = person(make, "owner@example.com", admin=True), person(make, "op@example.com", admin=True), person(make, "lee@example.com")
    # No owner set: nobody, not even the account that would be it.
    assert change(client, signer, owner, member).status_code == 403
    owned(client, owner)
    assert change(client, signer, other, member).status_code == 403          # another admin
    assert change(client, signer, member, member).status_code == 403         # a member
    assert client.get(f"/api/admin/members/{member.id}", headers=bearer(signer, other)).json()["canSetAdmin"] is False
    assert change(client, signer, owner, owner, grant=False).status_code == 409  # not itself
    client.app.dependency_overrides[get_settings] = lambda: settings(admin_owner_id="not-a-uuid")
    assert change(client, signer, owner, member).status_code == 403
    with make() as s:
        assert s.get(User, member.id).is_admin is False


def test_an_owner_that_was_revoked_or_stopped_is_no_owner(world):
    client, _, make, signer = world
    owner, member = person(make, "owner@example.com", admin=True), person(make, "lee@example.com")
    owned(client, owner)
    with make() as s:
        s.get(User, owner.id).is_admin = False
        s.commit()
    assert change(client, signer, owner, member).status_code == 403


def test_only_a_confirmed_account_in_use_becomes_an_admin(world):
    client, _, make, signer = world
    owner = person(make, "owner@example.com", admin=True)
    unconfirmed = person(make, "new@example.com")
    with make() as s:
        s.get(User, unconfirmed.id).email_verified_at = None
        s.commit()
    stopped = person(make, "bad@example.com", suspended_at=datetime.now(timezone.utc), suspended_reason="spam")
    owned(client, owner)
    assert change(client, signer, owner, unconfirmed).status_code == 409
    assert change(client, signer, owner, stopped).status_code == 409


def test_another_admin_cannot_sign_the_owner_out_or_stop_it(world):
    client, _, make, signer = world
    owner, other = person(make, "owner@example.com", admin=True), person(make, "op@example.com", admin=True)
    owned(client, owner)
    answer = client.post(f"/api/admin/members/{owner.id}/signout", json={"reason": ""}, headers=bearer(signer, other))
    assert answer.status_code == 409
    assert client.get(f"/api/admin/members/{owner.id}", headers=bearer(signer, other)).json()["owner"] is True
    # Nor stop it, even while a server command has taken its admin rights away.
    with make() as s:
        s.get(User, owner.id).is_admin = False
        s.commit()
    answer = client.post(f"/api/admin/members/{owner.id}/suspend", json={"reason": "잠시 정지", "notify": False}, headers=bearer(signer, other))
    assert answer.status_code == 409
    with make() as s:
        assert s.get(User, owner.id).suspended_at is None


def test_the_server_command_lists_ids_and_records_its_changes(world, monkeypatch, capsys):
    _, _, make, _ = world
    member = person(make, "lee@example.com")
    monkeypatch.setattr(cli, "get_sessionmaker", lambda: make)
    monkeypatch.setattr("sys.argv", ["admin", "grant", "lee@example.com"])
    cli.main()
    monkeypatch.setattr("sys.argv", ["admin", "list"])
    cli.main()
    assert f"admin: {member.id} lee@example.com" in capsys.readouterr().out
    with make() as s:
        user = s.get(User, member.id)
        assert user.is_admin and user.token_version == 1
        record = s.scalar(select(AdminAudit).where(AdminAudit.action == "grant_admin"))
        assert record.actor_id is None and record.detail == {"before": False, "after": True, "via": "cli"}


def test_a_change_reads_the_admin_again_right_before_it_writes(world):
    """require_admin_write (2026-11-29): an admin that require_admin let through a moment ago, whose rights were taken
    away, whose sessions were ended, or that was stopped since, is refused before anything is written."""
    import pytest
    from fastapi import HTTPException

    from app.routes.reports import require_admin_write
    _, _, make, _ = world
    for change in ({"is_admin": False}, {"token_version": 1}, {"suspended_at": datetime.now(timezone.utc)}):
        other = person(make, f"op{len(change)}{list(change)[0]}@example.com", admin=True)
        with make() as s:
            seen = s.get(User, other.id)  # what require_admin saw
            with make() as t:
                fresh = t.get(User, other.id)
                for key, value in change.items():
                    setattr(fresh, key, value)
                t.commit()
            with pytest.raises(HTTPException) as refused:
                require_admin_write(seen, s)
            assert refused.value.status_code == 403
    still = person(make, "still@example.com", admin=True)
    with make() as s:
        assert require_admin_write(s.get(User, still.id), s).id == still.id
