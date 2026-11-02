// API server access. Without VITE_API_BASE_URL the app stays in offline mode and never calls this module's fetch.
export const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
export const apiEnabled = (base = API_BASE_URL) => base !== '';

export type ApiErrorKind = 'offline' | 'timeout' | 'http' | 'invalid';
export class ApiError extends Error {
  constructor(readonly kind: ApiErrorKind, message: string, readonly status?: number) { super(message); this.name = 'ApiError'; }
}

type Options = { base?: string; method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; timeoutMs?: number; signal?: AbortSignal; fetchImpl?: typeof fetch; headers?: Record<string, string> };

/** Fetches JSON and checks its shape; every failure surfaces as an ApiError so callers can offer the local fallback.
 * A 204 answer is returned as `null` (validate decides whether that is acceptable). */
export async function apiJson<T>(path: string, validate: (value: unknown) => value is T, options: Options = {}): Promise<T> {
  const { base = API_BASE_URL, method = 'GET', body, timeoutMs = 10000, signal, fetchImpl = fetch, headers: extra } = options;
  if (!apiEnabled(base)) throw new ApiError('offline', 'API server is not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new ApiError('timeout', `no response within ${timeoutMs}ms`)), timeoutMs);
  const forward = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', forward, { once: true });
  try {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, { method, signal: controller.signal, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (error) {
      if (controller.signal.reason instanceof ApiError) throw controller.signal.reason;
      throw new ApiError('offline', error instanceof Error ? error.message : 'network error');
    }
    if (!response.ok) {
      // The server's own message (FastAPI `detail`) when it has one: the login form shows it as is.
      let detail = '';
      try { const text = await response.text(); const parsed = JSON.parse(text); if (typeof parsed?.detail === 'string') detail = parsed.detail; } catch { /* no usable body */ }
      throw new ApiError('http', detail || `HTTP ${response.status}`, response.status);
    }
    let value: unknown;
    if (response.status === 204) value = null;
    else try { value = await response.json(); } catch { throw new ApiError('invalid', 'response is not JSON'); }
    if (!validate(value)) throw new ApiError('invalid', 'unexpected response shape');
    return value;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forward);
  }
}
