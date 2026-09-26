/**
 * The API client.
 *
 * Relative by default (`/api/v1`), because requests go through the Next.js rewrite
 * in next.config.ts rather than straight to the backend. That keeps everything
 * same-origin, so cookies stay SameSite=Lax and CORS never enters the picture.
 */
const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api/v1';

export interface ApiErrorDetail {
  path: string;
  message: string;
}

/**
 * Carries the backend's stable `code` alongside the message.
 *
 * The code is what the UI branches on — `POOL_CAPACITY_EXCEEDED` needs a different
 * response from `ROUTE_NOT_COMPATIBLE`, and matching on human-readable text would
 * break the moment someone rewords a message.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ApiErrorDetail[];
  readonly requestId: string | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    details: ApiErrorDetail[] = [],
    requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  /** True when the caller simply is not signed in. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  /** Field-level messages, keyed by path, for rendering next to inputs. */
  get fieldErrors(): Record<string, string> {
    return Object.fromEntries(this.details.map((d) => [d.path, d.message]));
  }
}

interface Envelope<T> {
  data: T;
  meta?: unknown;
}

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: ApiErrorDetail[];
    requestId?: string;
  };
}

async function parse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // A non-JSON body from a JSON API means something upstream failed — a proxy
    // error page, for instance. Surfaced rather than masked as a parse crash.
    throw new ApiError(res.status, 'MALFORMED_RESPONSE', text.slice(0, 200));
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  init?: { signal?: AbortSignal },
): Promise<{ data: T; meta?: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    // Required for the auth cookies to be sent at all.
    credentials: 'include',
    /**
     * Bypasses the browser's HTTP cache on every call.
     *
     * Everything this client fetches is live state, and a cached copy is
     * indistinguishable from a fresh one to the caller. That caused a real bug: the
     * driver's request board polls every few seconds, but the browser kept serving
     * a stale empty response, so a driver saw "nobody waiting" while passengers
     * were queued.
     *
     * The API also sends no-store, but this does not depend on that — a client that
     * can only be correct when a server two hops away is configured right is not
     * actually correct.
     */
    cache: 'no-store',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(init?.signal ? { signal: init.signal } : {}),
  });

  const payload = await parse(res);

  if (!res.ok) {
    const envelope = payload as ErrorEnvelope | null;
    const error = envelope?.error;
    throw new ApiError(
      res.status,
      error?.code ?? 'UNKNOWN_ERROR',
      error?.message ?? `Request failed with status ${res.status}`,
      error?.details ?? [],
      error?.requestId,
    );
  }

  // 204 carries no body; callers of those endpoints ignore the result.
  const envelope = (payload ?? { data: null }) as Envelope<T>;
  return { data: envelope.data, meta: envelope.meta };
}

export const api = {
  async get<T>(path: string, init?: { signal?: AbortSignal }): Promise<T> {
    return (await request<T>('GET', path, undefined, init)).data;
  },

  /** For endpoints whose `meta` matters — pagination cursors, settlement lines. */
  async getWithMeta<T, M = unknown>(
    path: string,
    init?: { signal?: AbortSignal },
  ): Promise<{ data: T; meta: M }> {
    const result = await request<T>('GET', path, undefined, init);
    return { data: result.data, meta: result.meta as M };
  },

  async post<T>(path: string, body?: unknown): Promise<T> {
    return (await request<T>('POST', path, body)).data;
  },

  async postWithMeta<T, M = unknown>(
    path: string,
    body?: unknown,
  ): Promise<{ data: T; meta: M }> {
    const result = await request<T>('POST', path, body);
    return { data: result.data, meta: result.meta as M };
  },

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return (await request<T>('PATCH', path, body)).data;
  },

  async patchWithMeta<T, M = unknown>(
    path: string,
    body?: unknown,
  ): Promise<{ data: T; meta: M }> {
    const result = await request<T>('PATCH', path, body);
    return { data: result.data, meta: result.meta as M };
  },
};
