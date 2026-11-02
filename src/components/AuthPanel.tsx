import { useState } from 'react';
import { ArrowRight, Info, LogIn, UserPlus } from 'lucide-react';
import { authErrorMessage, login, signup, type AuthSession } from '../api/auth';

type Mode = 'login' | 'signup';

/** Email + password sign-in and sign-up (server mode). `onSuccess` receives the server session; `onGuest` continues without an account. */
export function AuthPanel({ online, initialMode = 'login', initialName = '', onSuccess, onGuest }: { online: boolean; initialMode?: Mode; initialName?: string; onSuccess: (session: AuthSession, mode: Mode) => Promise<void> | void; onGuest: () => void }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const ready = online && !busy && email.trim() && password.length >= 8 && (mode === 'login' || name.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true); setError('');
    try {
      const session = mode === 'signup' ? await signup(email.trim(), password, name.trim()) : await login(email.trim(), password);
      await onSuccess(session, mode);
    } catch (err) {
      setError(authErrorMessage(err, mode));
    } finally { setBusy(false); }
  }

  return <div className="auth-panel">
    <div className="filter-tabs auth-tabs" role="group" aria-label="로그인 또는 회원가입">
      {(['login', 'signup'] as Mode[]).map(m => <button key={m} aria-pressed={mode === m} className={mode === m ? 'active' : ''} onClick={() => { setMode(m); setError(''); }}>{m === 'login' ? '로그인' : '회원가입'}</button>)}
    </div>
    {!online && <div className="notice warning" role="status"><Info size={18} /><div><strong>추천 서버가 연결된 사이트에서만 로그인할 수 있어요.</strong><p>지금은 이 브라우저만으로 동작하는 모드예요. 취향과 기록은 이 브라우저에 저장돼요.</p></div></div>}
    <form onSubmit={submit} className="auth-form" aria-busy={busy}>
      {mode === 'signup' && <><label className="field-title" htmlFor="auth-name">이름 <small>16자 이내</small></label><input id="auth-name" autoComplete="nickname" maxLength={16} required value={name} onChange={e => setName(e.target.value)} placeholder="어떻게 불러드릴까요?" /></>}
      <label className="field-title" htmlFor="auth-email">이메일</label>
      <input id="auth-email" type="email" autoComplete="email" inputMode="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
      <label className="field-title" htmlFor="auth-password">비밀번호 <small>8자 이상</small></label>
      <input id="auth-password" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={8} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} placeholder="8자 이상" />
      {error && <div className="error-box" role="alert">{error}</div>}
      <button className="button primary full-width" disabled={!ready}>{busy ? <span className="spinner" /> : mode === 'signup' ? <UserPlus size={17} /> : <LogIn size={17} />}{busy ? (mode === 'signup' ? '가입하는 중' : '로그인하는 중') : mode === 'signup' ? '가입하고 시작하기' : '로그인'}</button>
    </form>
    <p className="small muted auth-note">{mode === 'signup' ? '가입하면 이 브라우저의 취향·즐겨찾기·기록이 계정에 저장되어 다른 기기에서도 이어 쓸 수 있어요.' : '로그인하면 계정에 저장된 취향·즐겨찾기·기록을 불러와요. 이 브라우저의 데이터는 따로 보관해요.'}</p>
    <button className="text-button auth-guest" onClick={onGuest}>로그인 없이 계속 <ArrowRight size={15} /></button>
  </div>;
}
