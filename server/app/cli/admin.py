"""Who may read error reports: python -m app.cli.admin grant|revoke|list [email]

The account must exist already. There is no route that grants this and no list of addresses in the settings: sign-up does not
verify email, so whoever registered an address first would otherwise become an admin.
"""
import argparse

from sqlalchemy import select

from ..auth import normalize_email
from ..db import get_sessionmaker
from ..models import User


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("action", choices=["grant", "revoke", "list"])
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
        user.is_admin = args.action == "grant"
        session.commit()
        print(f"{args.action}: done")


if __name__ == "__main__":
    main()
