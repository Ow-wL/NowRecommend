import { API_BASE_URL, apiEnabled } from './api/client';

// What went wrong in someone's browser reaches the server's log (POST /api/client-errors, 2026-11-17): the message, where
// in the code, which screen and which build. E-mail addresses and anything that looks like a token are cut out first
// (scrub); an error's own words can still echo a little of what was on the screen, and the privacy policy says so.
// Without it a blank screen in production is invisible. A handful per visit at most, each distinct error once.
const MAX_PER_VISIT = 5;
const sent = new Set<string>();
export const RELEASE = String(import.meta.env?.VITE_RELEASE ?? '').trim().slice(0, 40) || 'dev';

export type ClientError = { kind: 'render' | 'error' | 'promise'; message: string; stack: string; page: string; release: string };
/** The first part of the address only (#/reset/<token> → "reset"): which screen, never what was on it. */
export const pageOf = (hash: string) => (hash.match(/^#\/([a-z]+)/)?.[1] ?? 'home').slice(0, 20);
/** Noise that is not the app's: browser extensions, the script Instagram/Facebook's in-app browser adds to the page
 * (iabjs://, e.g. "Java object is gone" when that browser closes, 2026-11-24), and a layout notice browsers raise on their own. */
const ignorable = (message: string, stack: string) => /(extension|iabjs):\/\//.test(stack) ||/^ResizeObserver loop/.test(message) || message === 'Script error.';

/** Takes out what could identify someone if an error's text happened to carry it: e-mail addresses, long random-looking
 * strings (tokens, ids), and whatever follows ? or # in an address. */
export const scrub = (text: string) => text
  .replace(/[^\s@"'<>()]+@[^\s@"'<>()]+\.[^\s@"'<>()]+/g, '[email]')
  .replace(/([?#])[^\s"')]*/g, '$1…')
  .replace(/[A-Za-z0-9_-]{24,}(?:\.[A-Za-z0-9_-]{16,})*/g, '[long]');

export function describeError(kind: ClientError['kind'], error: unknown, hash: string, release = RELEASE): ClientError | null {
  const message = scrub(String(error instanceof Error ? error.message : error ?? '')).slice(0, 300);
  const stack = error instanceof Error ? scrub(String(error.stack ?? '')).slice(0, 2000) : '';
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
