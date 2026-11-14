const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000/api";

/** Endpoints where a 401 means bad credentials, not an expired session. */
const NO_REFRESH_PATHS = new Set([
  "/auth/login",
  "/auth/register",
  "/auth/refresh",
  "/auth/logout",
]);

export class ApiError extends Error {
  readonly status: number;
  /** Field-level messages keyed by input name, e.g. `{ email: "…" }`. */
  readonly fields: Record<string, string>;

  constructor(message: string, status: number, fields: Record<string, string> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fields = fields;
  }
}

// --- Access token store ----------------------------------------------------
//
// The access token lives here rather than in React state so that a background
// refresh (triggered from any component) can update every caller at once.

let accessToken: string | null = null;
let refreshInFlight: Promise<string | null> | null = null;

const sessionListeners = new Set<() => void>();

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * Subscribe to session invalidation. Used by the auth provider to drop the
 * user when a refresh finally fails (i.e. the refresh cookie is gone).
 */
export function subscribeToSession(listener: () => void): () => void {
  sessionListeners.add(listener);

  return () => {
    sessionListeners.delete(listener);
  };
}

function endSession(): void {
  accessToken = null;
  sessionListeners.forEach((listener) => listener());
}

// --- Request plumbing ------------------------------------------------------

function normalizeErrors(value: unknown): Record<string, string> {
  if (Array.isArray(value)) {
    return Object.fromEntries(
      value.flatMap((issue) => {
        if (!issue || typeof issue !== "object") return [];

        const { path, message } = issue as { path?: unknown; message?: unknown };

        return typeof path === "string" && typeof message === "string"
          ? [[path, message]]
          : [];
      }),
    );
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  }

  return {};
}

function toApiError(status: number, data: unknown): ApiError {
  const fallback =
    status === 401
      ? "Your session has expired. Please sign in again."
      : status === 429
        ? "Too many attempts. Please wait a moment and try again."
        : status >= 500
          ? "Something went wrong on our side. Please try again."
          : `Request failed (${status})`;

  if (data && typeof data === "object") {
    const body = data as Record<string, unknown>;
    const message =
      typeof body.message === "string" && body.message.length > 0
        ? body.message
        : fallback;

    return new ApiError(message, status, normalizeErrors(body.errors));
  }

  return new ApiError(fallback, status);
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();

  let data: unknown = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    throw toApiError(response.status, data);
  }

  return data as T;
}

/**
 * Exchange the httpOnly refresh cookie for a new access token. Concurrent
 * callers share a single in-flight request so a page with several parallel
 * fetches does not fire a refresh storm (each one rotating the token).
 */
async function refreshSession(): Promise<string | null> {
  if (refreshInFlight !== null) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        endSession();
        return null;
      }

      const payload = (await response.json()) as {
        data?: { accessToken?: unknown };
      };

      const token = payload.data?.accessToken;

      if (typeof token !== "string") {
        endSession();
        return null;
      }

      accessToken = token;
      return token;
    } catch {
      // Network failure: leave the session alone so a flaky connection does
      // not sign the user out.
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export interface ApiRequestOptions extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
}

/**
 * Return the current access token, refreshing it first when there is none.
 * Concurrent callers share one in-flight refresh, so several components
 * booting at the same moment produce a single round trip — and therefore a
 * single token rotation rather than a race.
 */
export async function ensureAccessToken(): Promise<string | null> {
  if (accessToken !== null) return accessToken;

  return refreshSession();
}

/**
 * Call the API with credentials and the bearer token attached. On a 401 the
 * session is refreshed once and the original request replayed, so callers do
 * not need to know anything about token lifetimes.
 */
export async function apiFetch<T>(
  path: string,
  options: ApiRequestOptions = {},
  allowRefresh = true,
): Promise<T> {
  const headers: Record<string, string> = { ...options.headers };

  if (options.body) {
    headers["Content-Type"] = "application/json";
  }

  if (accessToken !== null) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    // Required for the browser to send and store the refresh cookie.
    credentials: "include",
  });

  if (
    response.status === 401 &&
    allowRefresh &&
    !NO_REFRESH_PATHS.has(path) &&
    accessToken !== null
  ) {
    const refreshed = await refreshSession();

    if (refreshed !== null) {
      return apiFetch<T>(path, options, false);
    }
  }

  return parseResponse<T>(response);
}
