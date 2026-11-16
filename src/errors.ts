import { API_BASE_URL, apiEnabled } from './api/client';

// What went wrong in someone's browser reaches the server's log (POST /api/client-errors, 2026-11-17): the message, where
// in the code, which screen and which build. Nothing the person typed and nothing about the account is sent on purpose.
// Without it a blank screen in production is invisible. A handful per visit at most, each distinct error once.
const MAX_PER_VISIT = 5;
const sent = new Set<string>();
export const RELEASE = String(import.meta.env?.VITE_RELEASE ?? '').trim().slice(0, 40) || 'dev';

export type ClientError = { kind: 'render' | 'error' | 'promise'; message: string; stack: string; page: string; release: string };
/** The first part of the address only (#/reset/<token> → "reset"): which screen, never what was on it. */
export const pageOf = (hash: string) => (hash.match(/^#\/([a-z]+)/)?.[1] ?? 'home').slice(0, 20);
/** Noise that is not the app's: browser extensions, and a layout notice browsers raise on their own. */
const ignorable = (message: string, stack: string) => /extension:\/\//.test(stack) || /^ResizeObserver loop/.test(message) || message === 'Script error.';

export function describeError(kind: ClientError['kind'], error: unknown, hash: string, release = RELEASE): ClientError | null {
  const message = String(error instanceof Error ? error.message : error ?? '').slice(0, 300);
  const stack = error instanceof Error ? String(error.stack ?? '').slice(0, 2000) : '';
  if (!message || ignorable(message, stack)) return null;
  return { kind, message, stack, page: pageOf(hash), release };
}

export function reportError(kind: ClientError['kind'], error: unknown, send: (body: string) => void = post): void {
  if (!apiEnabled() || sent.size >= MAX_PER_VISIT) return;
  const report = describeError(kind, error, window.location.hash);
  if (!report || sent.has(`${kind}|${report.message}`)) return;
  sent.add(`${kind}|${report.message}`);
  try { send(JSON.stringify(report)); } catch { /* reporting must never be the next error */ }
}
function post(body: string) {
  void fetch(`${API_BASE_URL}/api/client-errors`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => { /* offline: nothing to do */ });
}
export function installErrorReporting(): void {
  window.addEventListener('error', event => reportError('error', event.error ?? event.message));
  window.addEventListener('unhandledrejection', event => reportError('promise', event.reason));
}
