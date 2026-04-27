/**
 * HTTP client for the mdreview backend.
 *
 * Reads:
 *   MDREVIEW_SERVER_URL  — backend root URL (default: http://localhost:3001)
 *   MDREVIEW_USERNAME    — basic auth username (optional)
 *   MDREVIEW_PASSWORD    — basic auth password (optional)
 */

export interface ApiError {
  status: number;
  error: string;
  body: any;
}

function baseUrl(): string {
  return (process.env.MDREVIEW_SERVER_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
}

function authHeader(): Record<string, string> {
  const u = process.env.MDREVIEW_USERNAME;
  const p = process.env.MDREVIEW_PASSWORD;
  if (!u || !p) return {};
  const token = btoa(`${u}:${p}`);
  return { Authorization: `Basic ${token}` };
}

async function request<T>(
  method: string,
  path: string,
  query?: Record<string, string | number | undefined>,
  body?: unknown,
): Promise<T> {
  const url = new URL(baseUrl() + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  const headers: Record<string, string> = { ...authHeader() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw {
      status: 0,
      error: 'network_error',
      body: { detail: (err as Error).message },
    } satisfies ApiError;
  }

  let payload: any = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!res.ok) {
    throw {
      status: res.status,
      error: payload?.error ?? `http_${res.status}`,
      body: payload,
    } satisfies ApiError;
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, query?: Record<string, string | number | undefined>) =>
    request<T>('GET', path, query),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, undefined, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, undefined, body),
};

export function isApiError(e: unknown): e is ApiError {
  return typeof e === 'object' && e !== null && 'status' in e && 'error' in e;
}
