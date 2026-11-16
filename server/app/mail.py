"""Outgoing mail (2026-11-17): the password reset link, sent over SMTP with the standard library.

SMTP rather than one provider's API, so the provider is a matter of five settings (SMTP_HOST, SMTP_PORT, SMTP_USER,
SMTP_PASSWORD, MAIL_FROM) and can change without code: any transactional mail service or a mailbox's own SMTP works.
Port 465 speaks TLS from the first byte; any other port starts plain and must upgrade (STARTTLS) before the password
is sent. Without SMTP_HOST there is no mailer and the routes that need one answer 503.
"""
import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, parseaddr
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
        message.set_content(text)
        if html:
            message.add_alternative(html, subtype="html")
        return message

    def send(self, to: str, subject: str, text: str, html: str | None = None) -> None:
        context = ssl.create_default_context()
        if self.port == 465:
            server = smtplib.SMTP_SSL(self.host, self.port, timeout=self.timeout, context=context)
        else:
            server = smtplib.SMTP(self.host, self.port, timeout=self.timeout)
        with server:
            if self.port != 465:
                server.starttls(context=context)  # raises when the server cannot upgrade: the password never goes out in the clear
            if self.user:
                server.login(self.user, self.password or "")
            server.send_message(self.message(to, subject, text, html))


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


def _escape(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
