import { useEffect, useState } from 'react';
import { ArrowRight, BadgeCheck, Info, KeyRound, LogIn, Mail, UserPlus } from 'lucide-react';
import { authErrorMessage, confirmEmail, confirmReset, login, pendingSignup, requestReset, signup, type AuthSession, type SignupPending } from '../api/auth';
import { LEGAL_VERSION, MIN_AGE } from '../legal';
import { healthTerms } from '../sensitive';

type Mode = 'login' | 'signup' | 'forgot';

/** Email + password sign-in and sign-up (server mode), and the way back in for a forgotten password: `forgot` asks for
 * the mail, and a link from that mail brings `resetToken`, which shows the new-password form instead of everything else.
 * `onSuccess` receives the server session; `onGuest` continues without an account.
 * Since 2026-11-18 a sign-up may answer without a session: the address is confirmed first, by the link of a mail
 * (`verifyToken` brings it back here: one button confirms, then the person logs in). */
export function AuthPanel({ online, initialMode = 'login', initialName = '', resetToken, onResetDone, verifyToken, onVerifyDone, onSuccess, onGuest }: {
  online: boolean; initialMode?: Mode; initialName?: string; resetToken?: string; /** `again`: the link did not work and a new mail is wanted */ onResetDone?: (again?: boolean) => void;
  verifyToken?: string; onVerifyDone?: () => void;
  onSuccess: (session: AuthSession, mode: 'login' | 'signup') => Promise<void> | void; onGuest: () => void;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [mailed, setMailed] = useState('');
  const [pending, setPending] = useState<SignupPending | null>(null);  // signed up; the confirmation mail is on its way
  const [confirmed, setConfirmed] = useState('');  // the address the link just confirmed: the login form starts from it
  useEffect(() => { if (verifyToken) { setConfirmed(''); setError(''); } }, [verifyToken]);  // another link opened on this page: its own button
  // Sign-up: the terms, the privacy policy and the age, each agreed to on its own. Nothing is ticked beforehand.
  const [agreed, setAgreed] = useState({ terms: false, privacy: false, adult: false });
  const allAgreed = agreed.terms && agreed.privacy && agreed.adult;
  const ready = online && !busy && (resetToken ? password.length >= 8 : !!email.trim() && (mode === 'forgot' || password.length >= 8 && (mode === 'login' || !!name.trim() && allAgreed)));
  const go = (next: Mode) => { setMode(next); setError(''); setMailed(''); setPending(null); };

  async function confirm() {
    if (!verifyToken || busy) return;
    setBusy(true); setError('');
    try {
      const done = await confirmEmail(verifyToken);
      setEmail(done.email); setConfirmed(done.email); setMode('login'); onVerifyDone?.();
    } catch (err) { setError(authErrorMessage(err, 'verify')); } finally { setBusy(false); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    if (mode === 'signup' && !resetToken && healthTerms(name).length) { setError('이름에는 건강과 관련된 표현을 쓸 수 없어요. 다른 이름을 적어주세요.'); return; }
    setBusy(true); setError('');
    try {
      if (resetToken) {
        const session = await confirmReset(resetToken, password);
        setPassword('');
        await onSuccess(session, 'login');
        onResetDone?.();
      } else if (mode === 'forgot') {
        await requestReset(email.trim());
        setMailed(email.trim());
      } else {
        const answer = mode === 'signup' ? await signup(email.trim(), password, name.trim(), { termsVersion: LEGAL_VERSION, agreeTerms: agreed.terms, agreePrivacy: agreed.privacy, adult: agreed.adult }) : await login(email.trim(), password);
        if (pendingSignup(answer)) { setPending(answer); setPassword(''); return; }
        await onSuccess(answer, mode);
      }
    } catch (err) {
      setError(authErrorMessage(err, resetToken ? 'reset' : mode));
    } finally { setBusy(false); }
  }

  if (resetToken) return <div className="auth-panel">
    <form onSubmit={submit} className="auth-form" aria-busy={busy}>
      <label className="field-title" htmlFor="auth-new-password">새 비밀번호 <small>8자 이상</small></label>
      <input id="auth-new-password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} placeholder="8자 이상" autoFocus />
      {error && <div className="error-box" role="alert">{error}</div>}
      <button className="button primary full-width" disabled={!ready}>{busy ? <span className="spinner" /> : <KeyRound size={17} />}{busy ? '바꾸는 중' : '비밀번호 바꾸고 로그인'}</button>
    </form>
    <p className="small muted auth-note">비밀번호를 바꾸면 다른 기기에서는 모두 로그아웃돼요.</p>
    <button className="text-button auth-guest" onClick={() => onResetDone?.(true)}>메일 다시 받기 <ArrowRight size={15} /></button>
  </div>;

  if (verifyToken && !confirmed) return <div className="auth-panel">
    <div className="notice" role="status"><BadgeCheck size={18} /><div><strong>이메일 확인을 마무리해요.</strong><p>아래 버튼을 누르면 가입이 끝나요. 그다음 가입할 때 정한 비밀번호로 로그인해주세요.</p></div></div>
    {error && <div className="error-box" role="alert">{error}</div>}
    <button className="button primary full-width" disabled={!online || busy} onClick={confirm}>{busy ? <span className="spinner" /> : <BadgeCheck size={17} />}{busy ? '확인하는 중' : '이메일 확인하기'}</button>
    <button className="text-button auth-guest" onClick={() => onVerifyDone?.()}>로그인 화면으로 <ArrowRight size={15} /></button>
  </div>;

  if (pending) return <div className="auth-panel">
    <div className="notice" role="status"><Mail size={18} /><div>{pending.verify === 'sent'
      ? <><strong>메일함을 확인해주세요.</strong><p>{pending.email} 주소로 확인 메일을 보냈어요. 24시간 안에 메일의 버튼을 누르면 가입이 끝나고, 그다음 로그인할 수 있어요. 메일이 안 보이면 스팸함도 확인해주세요.</p></>
      : <><strong>가입은 됐지만 확인 메일을 보내지 못했어요.</strong><p>잠시 후 로그인을 시도하면 확인 메일을 다시 보내 드려요. 확인하지 않은 가입은 7일이 지나면 지워져요.</p></>}</div></div>
    <button className="button secondary full-width" onClick={() => { setEmail(pending.email); go('login'); }}><LogIn size={17} />로그인 화면으로</button>
  </div>;

  return <div className="auth-panel">
    {confirmed && mode === 'login' && <div className="notice" role="status"><BadgeCheck size={18} /><div><strong>이메일이 확인됐어요.</strong><p>가입할 때 정한 비밀번호로 로그인해주세요.</p></div></div>}
    {mode !== 'forgot' && <div className="filter-tabs auth-tabs" role="group" aria-label="로그인 또는 회원가입">
      {(['login', 'signup'] as const).map(m => <button key={m} aria-pressed={mode === m} className={mode === m ? 'active' : ''} onClick={() => go(m)}>{m === 'login' ? '로그인' : '회원가입'}</button>)}
    </div>}
    {!online && <div className="notice warning" role="status"><Info size={18} /><div><strong>추천 서버가 연결된 사이트에서만 로그인할 수 있어요.</strong><p>지금은 이 브라우저만으로 동작하는 모드예요. 취향과 기록은 이 브라우저에 저장돼요.</p></div></div>}
    {mode === 'forgot' && mailed ? <div className="notice" role="status"><Mail size={18} /><div><strong>메일을 확인해주세요.</strong><p>{mailed} 주소로 가입된 계정이 있다면 비밀번호를 다시 정하는 링크를 보냈어요. 링크는 30분 동안 한 번만 쓸 수 있어요. 메일이 안 보이면 스팸함도 확인해주세요.</p></div></div>
      : <form onSubmit={submit} className="auth-form" aria-busy={busy}>
        {mode === 'forgot' && <p className="modal-description">가입할 때 쓴 이메일을 적어주세요. 비밀번호를 다시 정하는 링크를 보내드려요.</p>}
        {mode === 'signup' && <><label className="field-title" htmlFor="auth-name">이름 <small>16자 이내</small></label><input id="auth-name" autoComplete="nickname" maxLength={16} required value={name} onChange={e => setName(e.target.value)} placeholder="어떻게 불러드릴까요?" /></>}
        <label className="field-title" htmlFor="auth-email">이메일</label>
        <input id="auth-email" type="email" autoComplete="email" inputMode="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
        {mode !== 'forgot' && <><label className="field-title" htmlFor="auth-password">비밀번호 <small>8자 이상</small></label>
          <input id="auth-password" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={8} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} placeholder="8자 이상" /></>}
        {mode === 'signup' && <fieldset className="consent"><legend className="sr-only">가입에 필요한 동의</legend>
          <div className="consent-row"><label><input type="checkbox" required checked={agreed.terms} onChange={e => setAgreed(a => ({ ...a, terms: e.target.checked }))} /><span>이용약관에 동의해요 <small>(필수)</small></span></label><a href="#/terms" target="_blank" rel="noopener" aria-label="이용약관 보기 (새 탭)">보기</a></div>
          <div className="consent-row"><label><input type="checkbox" required checked={agreed.privacy} onChange={e => setAgreed(a => ({ ...a, privacy: e.target.checked }))} /><span>개인정보 수집·이용에 동의해요 <small>(필수)</small></span></label><a href="#/privacy" target="_blank" rel="noopener" aria-label="개인정보 처리방침 보기 (새 탭)">보기</a></div>
          <div className="consent-row"><label><input type="checkbox" required checked={agreed.adult} onChange={e => setAgreed(a => ({ ...a, adult: e.target.checked }))} /><span>만 {MIN_AGE}세 이상이에요 <small>(필수)</small></span></label></div>
          <p className="small muted">수집 항목: 이메일, 이름, 비밀번호(암호화해 저장), 동의한 일시와 약관 버전, 이메일 확인 일시. 로그인과 계정 식별, 가입 확인·비밀번호 재설정 안내에 쓰고 계정을 삭제할 때까지 보관해요(확인하지 않은 가입은 7일이 지나면 삭제). 동의하지 않아도 로그인 없이 쓸 수 있어요.</p>
        </fieldset>}
        {error && <div className="error-box" role="alert">{error}</div>}
        <button className="button primary full-width" disabled={!ready}>{busy ? <span className="spinner" /> : mode === 'signup' ? <UserPlus size={17} /> : mode === 'forgot' ? <Mail size={17} /> : <LogIn size={17} />}{busy ? (mode === 'signup' ? '가입하는 중' : mode === 'forgot' ? '보내는 중' : '로그인하는 중') : mode === 'signup' ? '가입하고 시작하기' : mode === 'forgot' ? '재설정 메일 받기' : '로그인'}</button>
      </form>}
    {mode === 'login' && online && <button className="text-button auth-forgot" onClick={() => go('forgot')}>비밀번호를 잊으셨나요?</button>}
    {mode === 'forgot' ? <button className="text-button auth-guest" onClick={() => go('login')}>로그인으로 돌아가기 <ArrowRight size={15} /></button>
      : <><p className="small muted auth-note">{mode === 'signup' ? '가입하면 이 브라우저의 취향·즐겨찾기·기록이 계정에 저장되어 다른 기기에서도 이어 쓸 수 있어요.' : '로그인하면 계정에 저장된 취향·즐겨찾기·기록을 불러와요. 이 브라우저의 데이터는 따로 보관해요.'}</p>
        <button className="text-button auth-guest" onClick={onGuest}>로그인 없이 계속 <ArrowRight size={15} /></button></>}
  </div>;
}
