"""Who may use the admin console: python -m app.cli.admin grant|revoke|list [email]
An account's address, marked confirmed by the operator: python -m app.cli.admin verify email

The account must exist already. There is no list of addresses in the settings: whoever registered an address first would
otherwise become an admin. From the console only the owner account may change admin rights (ADMIN_OWNER_ID holds its user
id, which `list` prints; routes/admin.py set_admin); this command stays for the first admin and for emergencies, and its
grants and revokes go into the action record like the console's. `verify` is for the operator's own accounts when the
confirmation mail cannot reach them (EMAIL_VERIFICATION, routes/auth.py); a reset link confirms an address as well.
"""
import argparse
from datetime import datetime, timezone

from sqlalchemy import select

from ..auth import normalize_email
from ..db import get_sessionmaker
from ..models import AdminAudit, User
from ..routes.reports import admin_rights_lock


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("action", choices=["grant", "revoke", "list", "verify"])
    parser.add_argument("email", nargs="?")
    args = parser.parse_args()
    with get_sessionmaker()() as session:
        if args.action == "list":
            for u in session.scalars(select(User).where(User.is_admin)):
                print(f"admin: {u.id} {u.email}")
            return
        if not args.email:
            parser.error("email is required")
        if args.action in ("grant", "revoke"):
            admin_rights_lock(session, alone=True)  # as the console does: after admin changes under way, before new ones
        user = session.scalar(select(User).where(User.email == normalize_email(args.email)).with_for_update())
        if user is None:
            raise SystemExit("no account with that email; sign up first")
        if args.action == "verify":
            user.email_verified_at = user.email_verified_at or datetime.now(timezone.utc)
        else:
            before, user.is_admin = user.is_admin, args.action == "grant"
            if args.action == "grant" and not before:
                user.token_version += 1  # as from the console: a token from before the grant is not an admin token
            session.add(AdminAudit(actor_id=None, actor_email="(서버 명령)", action=f"{args.action}_admin", target_type="member",
                                   target_id=str(user.id), reason="", detail={"before": before, "after": user.is_admin, "via": "cli"}))
        session.commit()
        print(f"{args.action}: done")


if __name__ == "__main__":
    main()
