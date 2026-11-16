"""Outgoing mail (2026-11-17): the password reset link, sent over SMTP with the standard library.

SMTP rather than one provider's API, so the provider is a matter of five settings (SMTP_HOST, SMTP_PORT, SMTP_USER,
SMTP_PASSWORD, MAIL_FROM) and can change without code: any transactional mail service or a mailbox's own SMTP works.
Port 465 speaks TLS from the first byte; any other port starts plain and must upgrade (STARTTLS) before the password
is sent. Without SMTP_HOST there is no mailer and the routes that need one answer 503.
"""
import logging
import smtplib
import ssl
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import format_datetime, formataddr, make_msgid, parseaddr
from typing import Protocol

from .config import get_settings

log = logging.getLogger(__name__)


class Mailer(Protocol):
    def send(self, to: str, subject: str, text: str, html: str | None = None) -> None: ...


class SmtpMailer:
    def __init__(self, host: str, port: int, user: str | None, password: str | None, sender: str, timeout: float = 10.0):
        self.host, self.port, self.user, self.password, self.sender, self.timeout = host, port, user, password, sender, timeout

    def message(self, to: str, subject: str, text: str, html: str | None = None) -> EmailMessage:
        message = EmailMessage()
        name, address = parseaddr(self.sender)
        message["From"] = formataddr((name, address)) if name else address
        message["To"] = to
        message["Subject"] = subject
        # Neither smtplib nor EmailMessage adds these, and a mail without them reads as spam to the receiving side.
        # The id is made in the sender's own domain (the default would name this container's host).
        message["Date"] = format_datetime(datetime.now(timezone.utc))
        message["Message-ID"] = make_msgid(domain=address.rpartition("@")[2] or None)
        message["Auto-Submitted"] = "auto-generated"  # RFC 3834: vacation responders and the like do not answer it
        message.set_content(text)
        if html:
            message.add_alternative(html, subtype="html")
        return message

    def send(self, to: str, subject: str, text: str, html: str | None = None) -> None:
        with self._connect() as server:
            server.send_message(self.message(to, subject, text, html))

    def check(self) -> None:
        """Connects, upgrades and signs in, and sends nothing: raises what `send` would raise up to that point."""
        with self._connect() as server:
            server.noop()

    def _connect(self) -> smtplib.SMTP:
        """A connection that is encrypted and signed in. Closed again if either step fails."""
        context = ssl.create_default_context()
        if self.port == 465:
            server = smtplib.SMTP_SSL(self.host, self.port, timeout=self.timeout, context=context)
        else:
            server = smtplib.SMTP(self.host, self.port, timeout=self.timeout)
        try:
            if self.port != 465:
                server.starttls(context=context)  # raises when the server cannot upgrade: the password never goes out in the clear
            if self.user:
                server.login(self.user, self.password or "")
        except BaseException:
            server.close()
            raise
        return server


def get_mailer() -> Mailer | None:
    """None without SMTP_HOST and MAIL_FROM: mail is off."""
    settings = get_settings()
    if not settings.smtp_host or not settings.mail_from:
        return None
    return SmtpMailer(settings.smtp_host, settings.smtp_port, settings.smtp_user, settings.smtp_password, settings.mail_from)


def reset_mail(name: str, link: str, minutes: int) -> tuple[str, str, str]:
    """Subject, plain text and HTML of the password reset mail. The link is the only thing to act on."""
    subject = "[지금 추천] 비밀번호 재설정 안내"
    text = (f"{name}님, 안녕하세요.\n\n지금 추천 계정의 비밀번호 재설정을 요청하셨어요. 아래 주소를 열어 새 비밀번호를 정해주세요.\n\n{link}\n\n"
            f"이 주소는 {minutes}분 동안, 한 번만 쓸 수 있어요.\n요청하신 적이 없다면 이 메일은 무시하셔도 돼요. 비밀번호는 바뀌지 않아요.\n")
    html = (f'<div style="font-family:sans-serif;font-size:15px;line-height:1.6;color:#222">'
            f"<p>{_escape(name)}님, 안녕하세요.</p><p>지금 추천 계정의 비밀번호 재설정을 요청하셨어요. 아래 버튼을 눌러 새 비밀번호를 정해주세요.</p>"
            f'<p><a href="{_escape(link)}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#222;color:#fff;text-decoration:none">새 비밀번호 정하기</a></p>'
            f'<p style="color:#666;font-size:13px">이 링크는 {minutes}분 동안, 한 번만 쓸 수 있어요.<br>요청하신 적이 없다면 이 메일은 무시하셔도 돼요. 비밀번호는 바뀌지 않아요.</p></div>')
    return subject, text, html


def trial_mail() -> tuple[str, str, str]:
    """Subject, plain text and HTML of the mail an operator sends to see that sending works (python -m app.cli.mail)."""
    subject = "[지금 추천] 메일 발송 확인"
    text = "지금 추천의 메일 발송 설정을 확인하려고 운영자가 보낸 시험 메일이에요.\n이 메일이 보이면 발송이 정상이에요. 따로 하실 일은 없어요.\n"
    html = ('<div style="font-family:sans-serif;font-size:15px;line-height:1.6;color:#222">'
            "<p>지금 추천의 메일 발송 설정을 확인하려고 운영자가 보낸 시험 메일이에요.</p>"
            '<p style="color:#666;font-size:13px">이 메일이 보이면 발송이 정상이에요. 따로 하실 일은 없어요.</p></div>')
    return subject, text, html


def failure(error: Exception) -> str:
    """What kind of failure it was, for a log or a console: the error's name and the SMTP reply code. Not its text and
    not a traceback - a mail server's refusal quotes the recipient's address, and addresses are not written to the log."""
    code = getattr(error, "smtp_code", None)
    refused = getattr(error, "recipients", None)  # SMTPRecipientsRefused: {address: (code, reply)}
    if code is None and isinstance(refused, dict) and refused:
        code = next(iter(refused.values()))[0]
    return type(error).__name__ + (f" {code}" if isinstance(code, int) else "")


def _escape(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
