"""Who may read error reports and feedback: python -m app.cli.admin grant|revoke|list [email]
An account's address, marked confirmed by the operator: python -m app.cli.admin verify email

The account must exist already. There is no route that grants this and no list of addresses in the settings: whoever
registered an address first would otherwise become an admin. `verify` is for the operator's own accounts when the
confirmation mail cannot reach them (EMAIL_VERIFICATION, routes/auth.py); a reset link confirms an address as well.
"""
import argparse
from datetime import datetime, timezone

from sqlalchemy import select

from ..auth import normalize_email
from ..db import get_sessionmaker
from ..models import User


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("action", choices=["grant", "revoke", "list", "verify"])
    parser.add_argument("email", nargs="?")
    args = parser.parse_args()
    with get_sessionmaker()() as session:
        if args.action == "list":
            print(f"admins: {[u.email for u in session.scalars(select(User).where(User.is_admin))]}")
            return
        if not args.email:
            parser.error("email is required")
        user = session.scalar(select(User).where(User.email == normalize_email(args.email)))
        if user is None:
            raise SystemExit("no account with that email; sign up first")
        if args.action == "verify":
            user.email_verified_at = user.email_verified_at or datetime.now(timezone.utc)
        else:
            user.is_admin = args.action == "grant"
        session.commit()
        print(f"{args.action}: done")


if __name__ == "__main__":
    main()
