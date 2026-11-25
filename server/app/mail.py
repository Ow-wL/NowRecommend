"""Outgoing mail (2026-11-17): the password reset link, sent over SMTP with the standard library.

SMTP rather than one provider's API, so the provider is a matter of five settings (SMTP_HOST, SMTP_PORT, SMTP_USER,
SMTP_PASSWORD, MAIL_FROM) and can change without code: any transactional mail service or a mailbox's own SMTP works.
Port 465 speaks TLS from the first byte; any other port starts plain and must upgrade (STARTTLS) before the password
is sent. Without SMTP_HOST there is no mailer and the routes that need one answer 503.
"""
import logging
import smtplib
import ssl
from datetime import date, datetime, timezone
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
    """Subject, plain text and HTML of the password reset mail. The link is the only thing to act on. `name` is left out of
    the mail (2026-11-24): an account not yet confirmed carries whatever name its sign-up typed, and this mail goes to the
    inbox's owner under the service's own signed address."""
    subject = "[지금 추천] 비밀번호 재설정 안내"
    text = (f"안녕하세요.\n\n지금 추천 계정의 비밀번호 재설정을 요청하셨어요. 아래 주소를 열어 새 비밀번호를 정해주세요.\n\n{link}\n\n"
            f"이 주소는 {minutes}분 동안, 한 번만 쓸 수 있어요.\n요청하신 적이 없다면 이 메일은 무시하셔도 돼요. 비밀번호는 바뀌지 않아요.\n\n보내기 전용 주소라 답장은 받지 못해요.\n")
    href = _escape(link)
    body = (
        f'<p style="margin:0 0 6px;font-size:17px;font-weight:700;color:{_INK}">안녕하세요.</p>'
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


def verify_mail(name: str, link: str, hours: int) -> tuple[str, str, str]:
    """Subject, plain text and HTML of the mail that confirms a new account's address (2026-11-18). As in reset_mail, the
    name typed at sign-up is left out: anyone can sign up with someone else's address."""
    subject = "[지금 추천] 이메일 주소를 확인해주세요"
    text = (f"지금 추천에 가입해 주셔서 고마워요.\n\n아래 주소를 열고 \"이메일 확인하기\"를 누르면 가입이 끝나요. 그다음 가입할 때 정한 비밀번호로 로그인해 주세요.\n\n{link}\n\n"
            f"이 주소는 {hours}시간 동안 쓸 수 있어요.\n가입하신 적이 없다면 이 메일은 무시하셔도 돼요. 확인하지 않은 가입은 7일이 지나면 지워져요.\n\n"
            f"보내기 전용 주소라 답장은 받지 못해요.\n")
    href = _escape(link)
    body = (
        f'<p style="margin:0 0 6px;font-size:17px;font-weight:700;color:{_INK}">반가워요.</p>'
        f'<p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:{_TEXT}">지금 추천에 가입해 주셔서 고마워요. 아래 버튼을 누르고 열린 화면에서 확인을 마치면 가입이 끝나요. 그다음 가입할 때 정한 비밀번호로 로그인해 주세요.</p>'
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px"><tr>'
        f'<td bgcolor="{_INK}" style="background:{_INK};border-radius:999px">'
        f'<a href="{href}" style="display:inline-block;padding:15px 30px;font-size:16px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:999px">이메일 확인하기 &rarr;</a>'
        f'</td></tr></table>'
        f'<p style="margin:0 0 22px;line-height:1">'
        f'{_chip(f"{hours}시간 동안 유효", "#FFF6DF", "#6B4A00")}{_chip("확인 뒤 로그인", "#EDF4FD", "#2F5F9E")}</p>'
        f'<div style="margin:0 0 22px;padding:14px 16px;border-radius:16px;background:#FFF1EA;font-size:14px;line-height:1.6;color:#6E2A12">'
        f'가입하신 적이 없다면 이 메일은 무시하셔도 돼요. 확인하지 않은 가입은 7일이 지나면 지워져요.</div>'
        f'<p style="margin:0;font-size:12px;line-height:1.6;color:{_MUTED}">버튼이 열리지 않으면 아래 주소를 브라우저 주소창에 붙여 넣어 주세요.<br>'
        f'<a href="{href}" style="color:#2F5F9E;word-break:break-all">{href}</a></p>')
    html = _page(subject, "버튼 하나로 가입이 끝나요.", "이메일만 확인하면 끝나요", "가입을 마무리해요", body,
                 "이 주소로 지금 추천 가입을 신청해서 보내 드린 확인 메일이에요.", _site(link))
    return subject, text, html


def digest_mail(counts: dict[str, int], reports: int, first: date, last: date, admin: str) -> tuple[str, str, str]:
    """Subject, plain text and HTML of the operator's daily count of feedback and error reports (digest.py). Counts only."""
    labels = {"problem": "불편·오류", "idea": "제안", "praise": "칭찬", "other": "기타"}
    total = sum(counts.values())
    period = f"{first:%m/%d}" if first == last else f"{first:%m/%d}~{last:%m/%d}"
    subject = f"[지금 추천] 새 의견 {total}건, 오류 신고 {reports}건 ({period})"
    parts = ", ".join(f"{labels[k]} {n}" for k, n in counts.items() if n)
    text = (f"{period}에 들어온 것: 의견 {total}건{f' ({parts})' if parts else ''}, 오류 신고 {reports}건.\n\n"
            f"관리 화면에서 읽고 처리해 주세요: {admin}\n\n내용은 메일에 담지 않아요. 관리자 계정으로 로그인해야 보여요.\n")
    chips = "".join(_chip(f"{labels[k]} {n}", "#FFF6DF", "#6B4A00") for k, n in counts.items() if n)
    href = _escape(admin)
    body = (f'<p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:{_TEXT}">{_escape(period)}에 의견 <b>{total}건</b>, '
            f'오류 신고 <b>{reports}건</b>이 들어왔어요.</p>'
            + (f'<p style="margin:0 0 22px;line-height:1">{chips}</p>' if chips else '')
            + f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px"><tr>'
            f'<td bgcolor="{_INK}" style="background:{_INK};border-radius:999px">'
            f'<a href="{href}" style="display:inline-block;padding:15px 30px;font-size:16px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:999px">관리 화면 열기 &rarr;</a>'
            f'</td></tr></table>'
            f'<p style="margin:0;font-size:12px;line-height:1.6;color:{_MUTED}">내용은 메일에 담지 않아요. 관리자 계정으로 로그인해야 보여요.</p>')
    html = _page(subject, f"의견 {total}건, 오류 신고 {reports}건", "새로 들어온 의견", "운영자 알림", body,
                 "운영자에게 하루 한 번 보내는 알림이에요.", _site(admin))
    return subject, text, html


def suspend_mail(reason: str, terms: str) -> tuple[str, str, str]:
    """Subject, plain text and HTML of the notice an account gets when an admin restricts it (admin console, 2026-11-26;
    terms: the reason is told by the address the person signed up with). The reason is the admin's own words."""
    subject = "[지금 추천] 계정 이용 제한 안내"
    text = (f"안녕하세요.\n\n이용약관에 따라 지금 추천 계정의 이용을 제한했어요. 제한하는 동안에는 로그인할 수 없어요.\n\n"
            f"이유: {reason}\n\n이의가 있거나 계정의 열람·삭제를 원하면 이용약관에 적힌 문의 주소로 알려주세요. 확인해서 답할게요.\n{terms}\n\n"
            "보내기 전용 주소라 이 메일로 답장은 받지 못해요.\n")
    body = (f'<p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:{_TEXT}">이용약관에 따라 계정의 이용을 제한했어요. '
            '제한하는 동안에는 로그인할 수 없어요.</p>'
            f'<p style="margin:0 0 14px;padding:14px 16px;border-radius:14px;background:#FFF6DF;font-size:15px;line-height:1.6;color:#6B4A00">'
            f'<b>이유</b><br>{_escape(reason)}</p>'
            f'<p style="margin:0;font-size:14px;line-height:1.7;color:{_MUTED}">이의가 있거나 계정의 열람·삭제를 원하면 '
            f'<a href="{_escape(terms)}" style="color:{_INK}">이용약관</a>에 적힌 문의 주소로 알려주세요. 확인해서 답할게요.</p>')
    html = _page(subject, "계정 이용을 제한했어요.", "계정 이용을 제한했어요", "이용 제한 안내", body,
                 "이 메일은 지금 추천 계정의 이용 제한을 알리려고 보냈어요.", _site(terms))
    return subject, text, html


def trial_mail(site: str | None = None) -> tuple[str, str, str]:
    """Subject, plain text and HTML of the mail an operator sends to see that sending works (python -m app.cli.mail)."""
    subject = "[지금 추천] 메일 발송 확인"
    text = "지금 추천의 메일 발송 설정을 확인하려고 운영자가 보낸 시험 메일이에요.\n이 메일이 보이면 발송이 정상이에요. 따로 하실 일은 없어요.\n\n보내기 전용 주소라 답장은 받지 못해요.\n"
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
    try:
        host, port = parts.hostname, parts.port
    except ValueError:  # a port that is not a number
        return None
    if parts.scheme not in ("http", "https") or not host:
        return None
    name = host + (f":{port}" if port else "")  # the host alone: "user@" in an address is not part of the site's name
    return f"{parts.scheme}://{name}{parts.path or '/'}", name


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
