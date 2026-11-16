"""Is outgoing mail set up? python -m app.cli.mail check | send <address>

`check` connects to the mail server the settings name, upgrades the connection and signs in, and sends nothing: it tells a
wrong host, port or key apart from everything else. `send` then sends one short trial mail to the address given (the
operator's own), which is what shows that the sender's domain is verified and where the mail lands (inbox or spam).

The settings are the server's own (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, MAIL_FROM), so this is run where they
are set: the Cloud Run job, or a shell with the same variables. Exit code 0 only when the step worked. Neither the key
nor the address is printed; a failure is named by its kind and the server's reply code (app/mail.py failure).
"""
import argparse

from ..auth import normalize_email, valid_email
from ..config import get_settings
from ..mail import SmtpMailer, failure, get_mailer, trial_mail

HINTS = {
    "SMTPAuthenticationError": "the server refused the user or key (SMTP_USER, SMTP_PASSWORD)",
    "SMTPNotSupportedError": "the server offers no STARTTLS on this port: use 587 (STARTTLS) or 465 (TLS)",
    "SMTPSenderRefused": "the server refused the sender (MAIL_FROM): is the domain verified with the mail service?",
    "SMTPRecipientsRefused": "the server refused the recipient: a trial account may only send to its own address",
    "SMTPDataError": "the server refused the message: is the sender's domain verified with the mail service?",
    "SSLCertVerificationError": "the server's certificate does not match SMTP_HOST",
    "gaierror": "SMTP_HOST does not resolve",
    "TimeoutError": "no answer in time: SMTP_HOST or SMTP_PORT is wrong, or the port is blocked from here",
    "ConnectionRefusedError": "nothing listens on SMTP_HOST:SMTP_PORT",
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("action", choices=["check", "send"])
    parser.add_argument("address", nargs="?", help="where the trial mail goes (send)")
    args = parser.parse_args()
    settings, mailer = get_settings(), get_mailer()
    if not isinstance(mailer, SmtpMailer):
        raise SystemExit("mail is off: SMTP_HOST and MAIL_FROM are both needed")
    print(f"server {mailer.host}:{mailer.port} ({'TLS' if mailer.port == 465 else 'STARTTLS'}), user {'set' if mailer.user else 'none'}, "
          f"key {'set' if mailer.password else 'none'}, from {mailer.sender}, links open {settings.public_app_url}")
    if args.action == "send":
        if not args.address or not valid_email(normalize_email(args.address)):
            parser.error("send needs the address the trial mail goes to")
    try:
        if args.action == "check":
            mailer.check()
        else:
            mailer.send(normalize_email(args.address), *trial_mail())
    except Exception as error:  # noqa: BLE001 - whatever went wrong is reported by kind, never with its text
        kind = failure(error)
        hint = HINTS.get(kind.split()[0])
        raise SystemExit(f"{args.action}: failed ({kind})" + (f" - {hint}" if hint else "")) from None
    print(f"{args.action}: ok" + (" (signed in, nothing sent)" if args.action == "check" else " (accepted by the server; look in the inbox and the spam folder)"))


if __name__ == "__main__":
    main()
