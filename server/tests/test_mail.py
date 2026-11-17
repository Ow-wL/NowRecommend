"""The mail sender's own behaviour (app/mail.py) and the operator's check (python -m app.cli.mail). The reset flow that
uses the sender is in test_account_recovery.py."""
import smtplib
import ssl
import sys
from email.utils import parsedate_to_datetime

import pytest

from app import mail
from app.cli import mail as cli
from app.config import Settings
from app.mail import SmtpMailer, failure, reset_mail, trial_mail


class Server:
    """Stands in for smtplib.SMTP / SMTP_SSL: records the steps, and fails at the step a test names."""
    made: list["Server"] = []
    fail_at: dict[str, Exception] = {}
    noop_answer: tuple[int, bytes] = (250, b"OK")

    def __init__(self, host, port, timeout=None, context=None):
        self.host, self.port, self.steps, self.closed = host, port, [], False
        Server.made.append(self)
        self._step("connect")

    def _step(self, name, *detail):
        self.steps.append((name, *detail) if detail else name)
        if name in Server.fail_at:
            raise Server.fail_at[name]

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def close(self):
        self.closed = True

    def starttls(self, context=None):
        self._step("starttls")

    def login(self, user, password):
        self._step("login", user)

    def noop(self):
        self._step("noop")
        return Server.noop_answer

    def send_message(self, message):
        self.message = message
        self._step("send")


@pytest.fixture
def server(monkeypatch):
    Server.made, Server.fail_at, Server.noop_answer = [], {}, (250, b"OK")
    monkeypatch.setattr(mail.smtplib, "SMTP", Server)
    monkeypatch.setattr(mail.smtplib, "SMTP_SSL", Server)
    return Server


def test_a_mail_carries_the_headers_a_receiving_server_expects(server):
    SmtpMailer("smtp.example.com", 587, "user", "key", "지금 추천 <no-reply@nowrec.example>").send("lee@example.com", "제목", "본문", "<p>본문</p>")
    message = server.made[0].message
    assert parsedate_to_datetime(message["Date"]).tzinfo is not None
    assert message["Message-ID"].startswith("<") and message["Message-ID"].endswith("@nowrec.example>")  # the sender's domain, not this host's name
    assert message["Auto-Submitted"] == "auto-generated"
    again = SmtpMailer("smtp.example.com", 587, "user", "key", "no-reply@nowrec.example").message("lee@example.com", "제목", "본문")
    assert again["Message-ID"] != message["Message-ID"]
    # The Korean display name survives the trip through the header encoding.
    assert "no-reply@nowrec.example" in message["From"] and "지금 추천" in str(message["From"])
    assert "=?utf-8?" in message.as_string().lower()  # and goes out encoded, not as raw bytes in a header


def test_check_signs_in_and_sends_nothing_and_a_failed_sign_in_closes_the_connection(server):
    mailer = SmtpMailer("smtp.example.com", 587, "user", "key", "no-reply@nowrec.example")
    mailer.check()
    assert server.made[0].steps == ["connect", "starttls", ("login", "user"), "noop"] and server.made[0].closed
    server.fail_at = {"login": smtplib.SMTPAuthenticationError(535, b"bad key")}
    with pytest.raises(smtplib.SMTPAuthenticationError):
        mailer.send("lee@example.com", "제목", "본문")
    assert server.made[1].closed and "send" not in server.made[1].steps
    server.fail_at = {"starttls": smtplib.SMTPNotSupportedError("STARTTLS extension not supported by server.")}
    with pytest.raises(smtplib.SMTPNotSupportedError):
        mailer.check()
    assert server.made[2].steps == ["connect", "starttls"] and server.made[2].closed  # the key was never offered
    # Signed in, but the server will not take a command: that is not "ok".
    server.fail_at, server.noop_answer = {}, (421, b"4.7.0 try again later, lee@example.com")
    with pytest.raises(smtplib.SMTPResponseException) as refused:
        mailer.check()
    assert failure(refused.value) == "SMTPResponseException 421" and server.made[3].closed


def test_a_failure_is_named_by_kind_and_reply_code_only():
    assert failure(smtplib.SMTPAuthenticationError(535, b"bad key")) == "SMTPAuthenticationError 535"
    assert failure(smtplib.SMTPRecipientsRefused({"lee@example.com": (550, b"<lee@example.com> unknown")})) == "SMTPRecipientsRefused 550"
    assert failure(smtplib.SMTPSenderRefused(553, b"not verified", "no-reply@nowrec.example")) == "SMTPSenderRefused 553"
    assert failure(TimeoutError("timed out")) == "TimeoutError"
    assert failure(ssl.SSLCertVerificationError("hostname mismatch")) == "SSLCertVerificationError"


def run(monkeypatch, capsys, settings: Settings, *args: str) -> tuple[int | str | None, str]:
    """The command's exit status (None: finished normally) and everything it printed."""
    monkeypatch.setattr(mail, "get_settings", lambda: settings)
    monkeypatch.setattr(cli, "get_settings", lambda: settings)
    monkeypatch.setattr(sys, "argv", ["mail", *args])
    code = None
    try:
        cli.main()
    except SystemExit as stop:
        code = stop.code
    out = capsys.readouterr()
    return code, out.out + out.err + (code if isinstance(code, str) else "")


ON = Settings(smtp_host="smtp.example.com", smtp_port=587, smtp_user="resend", smtp_password="re_secret_key", mail_from="지금 추천 <no-reply@nowrec.example>",
              public_app_url="https://nowrec.example/")


def test_the_operators_check_reports_the_settings_without_the_key(server, monkeypatch, capsys):
    code, said = run(monkeypatch, capsys, ON, "check")
    assert code is None and "check: ok" in said and "smtp.example.com:587 (STARTTLS)" in said and "key set" in said
    assert "re_secret_key" not in said and server.made[0].steps[-1] == "noop"

    code, said = run(monkeypatch, capsys, Settings(smtp_host=None, mail_from=None), "check")
    assert isinstance(code, str) and "mail is off" in code


def test_the_trial_mail_goes_to_the_address_given_and_a_refusal_is_explained_without_quoting_it(server, monkeypatch, capsys):
    code, said = run(monkeypatch, capsys, ON, "send", " Lee@Example.com ")
    assert code is None and "send: ok" in said and "lee@example.com" not in said.lower()
    sent = server.made[0].message
    assert sent["To"] == "lee@example.com" and sent["Subject"] == trial_mail()[0]
    assert [part.get_content_type() for part in sent.iter_parts()] == ["text/plain", "text/html"]

    server.fail_at = {"send": smtplib.SMTPDataError(550, b"The nowrec.example domain is not verified. lee@example.com")}
    code, said = run(monkeypatch, capsys, ON, "send", "lee@example.com")
    assert isinstance(code, str) and "send: failed (SMTPDataError 550)" in code and "verified" in code
    assert "lee@example.com" not in said and "not verified." not in said  # the hint is ours; the server's text is not repeated

    server.fail_at = {"login": smtplib.SMTPAuthenticationError(535, b"Invalid API key re_secret_key")}
    code, said = run(monkeypatch, capsys, ON, "check")
    assert isinstance(code, str) and "SMTPAuthenticationError 535" in code and "re_secret_key" not in said

    code, said = run(monkeypatch, capsys, ON, "send")
    assert code == 2 and "needs the address" in said  # argparse usage error, nothing was connected
    assert len(server.made) == 3


# ---- the look of a mail (2026-11-17) ----

def test_a_mail_is_one_page_that_loads_nothing_and_carries_its_styles_on_its_elements():
    """A mail client drops stylesheets and scripts, and anything loaded from outside tells its host that the mail was
    opened. So: no image, no font, no stylesheet, no script, and the only addresses in it are the link and the site."""
    import re

    link = "https://nowrec.kr/#/reset/abc.def"
    for html in (reset_mail("주형", link, 30)[2], trial_mail("https://nowrec.kr/")[2]):
        assert html.startswith("<!doctype html>") and 'lang="ko"' in html and html.rstrip().endswith("</html>")
        for outside in ("<img", "<link", "<script", "<style", "@import", "url(", "src="):
            assert outside not in html
        assert set(re.findall(r'https?://[^"<\s]+', html)) <= {link, "https://nowrec.kr/"}
        assert "지금 추천" in html and "#F2F2F7" in html and "border-radius:28px" in html  # the site's page, card and name


def test_the_reset_mail_gives_the_link_twice_and_says_how_long_it_lasts():
    subject, text, html = reset_mail("주형", "https://nowrec.kr/#/reset/abc.def", 30)
    assert html.count('href="https://nowrec.kr/#/reset/abc.def"') == 2  # the button, and the address written out under it
    for line in ("새 비밀번호 정하기", "30분 동안 유효", "한 번만", "요청하신 적이 없다면", "답장은 받지 못해요"):
        assert line in html
    assert 'href="https://nowrec.kr/"' in html  # the footer names the site the link opens
    assert "https://nowrec.kr/#/reset/abc.def" in text and "30분" in text  # the plain part says the same without the page


def test_a_mail_without_a_site_address_still_reads_whole():
    assert "nowrec.kr" not in trial_mail()[2] and "메일이 잘 도착했어요" in trial_mail()[2]
    assert "<a " not in trial_mail("not an address")[2]
