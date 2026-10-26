"""Database migrations: python -m app.cli.migrate [--contract] [--dry-run] [--downgrade REV]

Default: expand migrations only (what the API container and the seed job run on start). Contract migrations, which
remove columns old code still reads, stop the upgrade and are listed as waiting.
--contract   also apply contract migrations. Only after old revisions serve no traffic and are no rollback target.
--downgrade  go back to REV (e.g. 0002 before routing traffic to an image from before the price removal).
"""
import argparse

from ..migrations import downgrade, migrate, plan


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--contract", action="store_true", help="apply contract (destructive) migrations too")
    parser.add_argument("--dry-run", action="store_true", help="show the plan without changing the database")
    parser.add_argument("--downgrade", metavar="REV", help="downgrade to this revision instead")
    args = parser.parse_args()
    if args.downgrade:
        if not args.dry_run:
            downgrade(args.downgrade)
        print(f"migrate: {'would downgrade' if args.dry_run else 'downgraded'} to {args.downgrade}")
        return
    result = plan(args.contract) if args.dry_run else migrate(args.contract)
    action = "would upgrade" if args.dry_run else "upgraded"
    print(f"migrate: at {result.current or 'empty'}; " + (f"{action} to {result.target}" if result.target else "nothing to apply"))
    if result.waiting:
        print(f"migrate: contract migrations waiting: {', '.join(result.waiting)} (run with --contract once no old revision runs)")


if __name__ == "__main__":
    main()
