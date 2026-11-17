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
from urllib.parse import urlsplit

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
            code, reply = server.noop()
            if code != 250:  # signed in, yet the server will not take a command
                raise smtplib.SMTPResponseException(code, reply)

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
    href = _escape(link)
    body = (
        f'<p style="margin:0 0 6px;font-size:17px;font-weight:700;color:{_INK}">{_escape(name)}님, 안녕하세요.</p>'
        f'<p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:{_TEXT}">지금 추천 계정의 비밀번호 재설정을 요청하셨어요. 아래 버튼을 눌러 새 비밀번호를 정해주세요.</p>'
        # The button is a table cell with its own background, so a client that drops the link's padding still shows a button.
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px"><tr>'
        f'<td bgcolor="{_INK}" style="background:{_INK};border-radius:999px">'
        f'<a href="{href}" style="display:inline-block;padding:15px 30px;font-size:16px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:999px">새 비밀번호 정하기 &rarr;</a>'
        f'</td></tr></table>'
        f'<p style="margin:0 0 22px;line-height:1">'
        f'{_chip(f"{minutes}분 동안 유효", "#FFF6DF", "#6B4A00")}{_chip("한 번만 쓸 수 있어요", "#EDF4FD", "#2F5F9E")}</p>'
        f'<div style="margin:0 0 22px;padding:14px 16px;border-radius:16px;background:#FFF1EA;font-size:14px;line-height:1.6;color:#6E2A12">'
        f'요청하신 적이 없다면 이 메일은 무시하셔도 돼요. 비밀번호는 바뀌지 않아요.</div>'
        f'<p style="margin:0;font-size:12px;line-height:1.6;color:{_MUTED}">버튼이 열리지 않으면 아래 주소를 브라우저 주소창에 붙여 넣어 주세요.<br>'
        f'<a href="{href}" style="color:#2F5F9E;word-break:break-all">{href}</a></p>')
    html = _page(subject, f"{minutes}분 안에 새 비밀번호를 정해주세요.", "비밀번호를 다시 정해요", "버튼 하나면 끝나요.", body,
                 "비밀번호 재설정을 요청해서 보내 드린 안내 메일이에요.", _site(link))
    return subject, text, html


def trial_mail(site: str | None = None) -> tuple[str, str, str]:
    """Subject, plain text and HTML of the mail an operator sends to see that sending works (python -m app.cli.mail)."""
    subject = "[지금 추천] 메일 발송 확인"
    text = "지금 추천의 메일 발송 설정을 확인하려고 운영자가 보낸 시험 메일이에요.\n이 메일이 보이면 발송이 정상이에요. 따로 하실 일은 없어요.\n"
    body = (f'<p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:{_TEXT}">지금 추천의 메일 발송 설정을 확인하려고 운영자가 보낸 시험 메일이에요.</p>'
            f'<p style="margin:0;line-height:1">{_chip("발송 정상", "#EDF4FD", "#2F5F9E")}{_chip("따로 하실 일은 없어요", "#FFF6DF", "#6B4A00")}</p>')
    html = _page(subject, "이 메일이 보이면 발송이 정상이에요.", "메일이 잘 도착했어요", "발송 설정 확인", body,
                 "운영자가 발송 설정을 확인하려고 보낸 시험 메일이에요.", _site(site))
    return subject, text, html


# ---- the look of a mail (2026-11-17): the site's own, as far as a mail client lets it ----
# A mail client is not a browser: no stylesheet survives everywhere, so every style is written on its element; layout is
# tables; nothing is loaded from outside (no images, no fonts - opening the mail tells nobody that it was opened). The
# colours are the site's tokens (src/styles/tokens.css): the grey page, the white card, peach, sky and sun, the ink button.
_INK, _TEXT, _MUTED, _CANVAS = "#1C1C1E", "#3C3C43", "#5E5E63", "#F2F2F7"
_FONT = "-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Pretendard','Noto Sans KR','Malgun Gothic','Segoe UI',sans-serif"


def _chip(label: str, background: str, colour: str) -> str:
    return (f'<span style="display:inline-block;margin:0 6px 6px 0;padding:7px 13px;border-radius:999px;background:{background};'
            f'font-size:13px;font-weight:600;line-height:1.2;color:{colour}">{_escape(label)}</span>')


def _disc(colour: str) -> str:
    """One of the three rings of the home screen's cards: white, the colour, white. Padding makes the rings (a mail client
    keeps padding and drops positioning)."""
    return (f'<td style="padding:0 10px 0 0"><div style="width:20px;height:20px;padding:14px;border-radius:50%;background:#FFFFFF">'
            f'<div style="width:8px;height:8px;padding:6px;border-radius:50%;background:{colour}">'
            f'<div style="width:8px;height:8px;border-radius:50%;background:#FFFFFF"></div></div></div></td>')


def _site(link: str | None) -> tuple[str, str] | None:
    """The site's address and its bare name, from a link into it (the reset link, PUBLIC_APP_URL)."""
    parts = urlsplit(link or "")
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return None
    return f"{parts.scheme}://{parts.netloc}{parts.path or '/'}", parts.netloc


def _page(title: str, preheader: str, heading: str, kicker: str, body: str, why: str, site: tuple[str, str] | None) -> str:
    home = (f' &middot; <a href="{_escape(site[0])}" style="color:{_MUTED};text-decoration:underline">{_escape(site[1])}</a>' if site else "")
    return (
        f'<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<meta name="color-scheme" content="light only"><title>{_escape(title)}</title></head>'
        f'<body style="margin:0;padding:0;background:{_CANVAS}">'
        # What a mail list shows after the subject. Hidden in the mail itself.
        f'<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:{_CANVAS}">{_escape(preheader)}</div>'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="{_CANVAS}" style="background:{_CANVAS};font-family:{_FONT}">'
        f'<tr><td align="center" style="padding:32px 16px 40px">'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;text-align:left">'
        # The site's wordmark: the name and its peach dot.
        f'<tr><td style="padding:0 10px 16px;font-size:19px;font-weight:700;letter-spacing:-0.03em;color:{_INK}">지금 추천'
        f'<span style="display:inline-block;width:6px;height:6px;margin-left:4px;border-radius:50%;background:#F4A78F"></span></td></tr>'
        f'<tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border-radius:28px">'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
        # The band of the three cards' colours, peach to sun to sky. A client without gradients shows the peach.
        f'<tr><td bgcolor="#FFDCCD" style="padding:28px 32px 26px;border-radius:28px 28px 0 0;background:#FFDCCD;'
        f'background-image:linear-gradient(120deg,#FFDCCD 0%,#FBE3AE 52%,#D6E6FA 100%)">'
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px"><tr>'
        f'{_disc("#F4A78F")}{_disc("#F7D58C")}{_disc("#9EC3EE")}</tr></table>'
        f'<div style="font-size:13px;font-weight:700;letter-spacing:0.02em;color:#6E2A12">{_escape(kicker)}</div>'
        f'<div style="margin-top:6px;font-size:27px;font-weight:800;line-height:1.25;letter-spacing:-0.03em;color:{_INK}">{_escape(heading)}</div>'
        f'</td></tr>'
        f'<tr><td style="padding:28px 32px 32px">{body}</td></tr>'
        f'</table></td></tr>'
        f'<tr><td style="padding:18px 10px 0;font-size:12px;line-height:1.7;color:{_MUTED}">{_escape(why)} 보내기 전용 주소라 답장은 받지 못해요.<br>'
        f'지금 추천{home}</td></tr>'
        f'</table></td></tr></table></body></html>')


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
