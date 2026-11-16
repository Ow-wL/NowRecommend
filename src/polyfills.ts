// Functions the app calls that browsers a few years old do not have. The build lowers syntax for them (Vite's default
// target: Chrome 87, Safari 14) but adds no functions, so on such a browser the first call threw and the whole screen was
// replaced by the error page: a visitor's home screen broke on `crypto.randomUUID` (2026-11-17, from the error log).
// Each one is added only where it is missing. Imported first in main.tsx, before any module that might call them.
//   crypto.randomUUID, structuredClone, Array/String.prototype.at: Safari 15.4, Chrome 92-98.  AbortSignal.timeout: Safari 16, Chrome 103.

type Scope = { crypto?: Crypto; structuredClone?: unknown; AbortSignal?: typeof AbortSignal; AbortController?: typeof AbortController;
  Array: ArrayConstructor; String: StringConstructor; DOMException?: typeof DOMException; setTimeout: typeof setTimeout };

/** A version 4 UUID from random bytes (RFC 4122 §4.4); `Math.random` only where the browser has no random source at all. */
export function uuid(random?: (bytes: Uint8Array) => Uint8Array): string {
  const bytes = new Uint8Array(16);
  if (random) random(bytes); else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function at<T>(this: ArrayLike<T>, index: number): T | undefined {
  const n = Math.trunc(Number(index)) || 0;
  return this[n < 0 ? this.length + n : n];
}

export function installPolyfills(scope: Scope = globalThis as unknown as Scope): void {
  const crypto = scope.crypto;
  if (crypto && typeof crypto.randomUUID !== 'function') {
    const random = typeof crypto.getRandomValues === 'function' ? (bytes: Uint8Array) => crypto.getRandomValues(bytes) : undefined;
    try { Object.defineProperty(crypto, 'randomUUID', { value: () => uuid(random), configurable: true, writable: true }); } catch { /* a frozen object: nothing to add to */ }
  }
  // Everything the app copies is plain data that also goes through JSON on its way to storage (conditions, sessions, entries).
  if (typeof scope.structuredClone !== 'function') scope.structuredClone = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
  for (const proto of [scope.Array.prototype, scope.String.prototype] as object[]) {
    if (typeof (proto as { at?: unknown }).at !== 'function') Object.defineProperty(proto, 'at', { value: at, configurable: true, writable: true });
  }
  const Signal = scope.AbortSignal, Controller = scope.AbortController;
  if (Signal && Controller && typeof Signal.timeout !== 'function') {
    Signal.timeout = (ms: number) => {
      const controller = new Controller();
      scope.setTimeout(() => controller.abort(scope.DOMException ? new scope.DOMException('signal timed out', 'TimeoutError') : undefined), ms);
      return controller.signal;
    };
  }
}

installPolyfills();
