import { supabase } from "@/lib/supabase";

export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ||
  (process.env.NODE_ENV === "development"
    ? "http://127.0.0.1:8000/api"
    : "")
).replace(/\/+$/, "");

const DEFAULT_TIMEOUT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

type ApiErrorBody = {
  detail?: unknown;
  error?: unknown;
  [key: string]: unknown;
};

/** RequestInit with an opt-in timeout override for endpoints that run longer than usual. */
export type ApiRequestInit = RequestInit & { timeoutMs?: number };

function safeApiUrl(path: string): string {
  if (!API_URL) {
    throw new Error(
      "Falta NEXT_PUBLIC_API_URL. Configurá la URL pública de la API antes de usar la aplicación.",
    );
  }

  const normalizedPath = path.trim();
  if (
    !normalizedPath ||
    normalizedPath.startsWith("//") ||
    /^[a-z][a-z\d+.-]*:\/\//i.test(normalizedPath) ||
    normalizedPath.includes("\\")
  ) {
    throw new Error("La ruta de la API no es válida.");
  }

  const base = new URL(API_URL);
  if (
    process.env.NODE_ENV === "production" &&
    base.protocol !== "https:"
  ) {
    throw new Error("La API de producción debe utilizar HTTPS.");
  }
  const url = new URL(
    `${API_URL}${normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`}`,
  );
  // Prevent both cross-origin token leakage and accidental path traversal out of
  // the configured API prefix (e.g. /api/../admin/).
  const basePath = base.pathname.replace(/\/+$/, "");
  const insideApiPrefix = url.pathname === basePath || url.pathname.startsWith(`${basePath}/`);
  if (url.origin !== base.origin || !insideApiPrefix) {
    throw new Error("La ruta solicitada no pertenece a la API configurada.");
  }
  return url.toString();
}

function compactValue(value: unknown, maxLength = 1_500): string {
  if (typeof value === "string") return value.slice(0, maxLength);
  if (Array.isArray(value)) {
    return value.map((item) => compactValue(item, 350)).filter(Boolean).join(", ").slice(0, maxLength);
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key}: ${compactValue(item, 350)}`)
      .join("; ")
      .slice(0, maxLength);
  }
  return value == null ? "" : String(value).slice(0, maxLength);
}

function messageFromBody(body: ApiErrorBody, status: number): string {
  const candidate = body.detail ?? body.error;
  const candidateMessage = compactValue(candidate);
  if (candidateMessage.trim()) return candidateMessage;

  const fields = Object.entries(body).filter(([key]) => key !== "status");
  if (fields.length) {
    const message = fields
      .map(([key, value]) => `${key}: ${compactValue(value, 350)}`)
      .join("; ")
      .slice(0, 1_500);
    if (message) return message;
  }
  return `Error ${status}: no se pudo completar la solicitud.`;
}

async function readErrorBody(response: Response): Promise<ApiErrorBody> {
  const text = await response.text().catch(() => "");
  if (!text || text.length > 64_000) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as ApiErrorBody) : {};
  } catch {
    // Do not show arbitrary HTML, proxy banners or stack traces to the user.
    return {};
  }
}

async function requestApiResponse<T>(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  consume: (response: Response) => Promise<T>,
  knownAccessToken?: string,
): Promise<T> {
  const url = safeApiUrl(path);
  const headers = new Headers(init.headers);
  const hasBody = init.body !== undefined && init.body !== null;
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  if (hasBody && !isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const controller = new AbortController();
  const callerSignal = init.signal;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });

  const timeout = Number.isFinite(timeoutMs)
    ? Math.min(Math.max(timeoutMs, 1_000), 300_000)
    : DEFAULT_TIMEOUT_MS;
  // Start the deadline before auth/session access and keep it active until the
  // entire response body has been consumed, not just until headers arrive.
  const timeoutId = setTimeout(() => controller.abort("request-timeout"), timeout);

  try {
    if (controller.signal.aborted) {
      const cancelled = new Error("La solicitud fue cancelada.");
      cancelled.name = "AbortError";
      throw cancelled;
    }

    // Shared reads already resolved the session to scope their cache key. Reuse
    // that access token instead of querying Supabase Auth a second time.
    if (knownAccessToken) {
      headers.set("Authorization", `Bearer ${knownAccessToken}`);
    } else if (supabase) {
      // Only the public/publishable Supabase client is used here. A missing session
      // is allowed for public endpoints; protected endpoints fail closed in Django.
      try {
        const sessionResult = await Promise.race([
          supabase.auth.getSession(),
          new Promise<never>((_resolve, reject) => {
            const rejectOnAbort = () => {
              const aborted = new Error("La solicitud fue cancelada.");
              aborted.name = "AbortError";
              reject(aborted);
            };
            if (controller.signal.aborted) rejectOnAbort();
            else controller.signal.addEventListener("abort", rejectOnAbort, { once: true });
          }),
        ]);
        if (controller.signal.aborted) throw makeAbortError();
        const token = sessionResult.error ? undefined : sessionResult.data.session?.access_token;
        if (token) headers.set("Authorization", `Bearer ${token}`);
      } catch (cause) {
        if (controller.signal.aborted) throw cause;
        // Public endpoints should remain usable if browser session storage fails.
        // Protected endpoints still fail closed because no bearer token is attached.
      }
    }

    const response = await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
    });
    return await consume(response);
  } catch (cause) {
    if (controller.signal.aborted) {
      if (callerSignal?.aborted) {
        const cancelled = new Error("La solicitud fue cancelada.");
        cancelled.name = "AbortError";
        throw cancelled;
      }
      throw new Error("La solicitud tardó demasiado. Revisá la conexión e intentá nuevamente.");
    }
    if (cause instanceof TypeError) {
      throw new Error("No se pudo conectar con la API. Revisá la conexión y la configuración del servidor.");
    }
    throw cause;
  } finally {
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

async function parseSuccess<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  if (response.headers.get("content-type")?.includes("text/markdown")) {
    return (await response.text()) as T;
  }

  const text = await response.text();
  if (!text.trim()) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("La API devolvió una respuesta con formato inesperado.");
  }
}

type SharedReadEntry = { promise: Promise<unknown>; expiresAt: number };

// These short, read-only responses are requested by more than one component
// (notably the sidebar and the page content) and are also replayed by React
// Strict Mode in development. Coalesce in-flight reads and keep a very short
// per-user cache to avoid duplicate CORS preflights and unnecessary DB work.
// Mutations invalidate the cache, and errors are never cached.
const SHARED_READ_PATHS = new Set([
  "/courses/",
  "/courses/?nav=1",
  "/assessments/",
  "/corrections/?summary=1",
  "/dashboard/summary/",
  "/dashboard/overview/",
  // No assessment means this is selector metadata only, not student answers.
  "/correction-workspace/?summary=1",
]);
const DEFAULT_SHARED_READ_TTL_MS = 5_000;
const SHARED_READ_TTLS: Record<string, number> = {
  "/courses/?nav=1": 15_000,
  "/dashboard/overview/": 10_000,
  "/correction-workspace/?summary=1": 10_000,
};
const sharedReadCache = new Map<string, SharedReadEntry>();
let currentScopePromise: Promise<AuthScope | null> | null = null;

function isShareableRead(path: string, init: RequestInit): boolean {
  const method = (init.method || "GET").toUpperCase();
  if (method !== "GET" || init.body != null || !SHARED_READ_PATHS.has(path)) return false;
  // A custom Authorization/header set may alter response visibility or vary
  // the representation. Those requests must not share a cached response.
  if (init.headers) {
    let hasCustomHeader = false;
    new Headers(init.headers).forEach(() => { hasCustomHeader = true; });
    if (hasCustomHeader) return false;
  }
  return true;
}

function makeAbortError(): Error {
  const error = new Error("La solicitud fue cancelada.");
  error.name = "AbortError";
  return error;
}

function waitForCaller<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(makeAbortError());
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(makeAbortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => { cleanup(); resolve(value); },
      (error: unknown) => { cleanup(); reject(error); },
    );
  });
}

type AuthScope = { userId: string; accessToken: string };

async function readCurrentUserScope(): Promise<AuthScope | null> {
  if (!supabase) return null;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    // getSession is local storage access in normal operation; guard against a
    // broken auth lock so API calls are never blocked indefinitely before fetch.
    const result = await Promise.race([
      supabase.auth.getSession(),
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Supabase session lookup timed out")), 3_000);
      }),
    ]);
    const session = result.data.session;
    if (result.error || !session?.user.id || !session.access_token) return null;
    return { userId: session.user.id, accessToken: session.access_token };
  } catch {
    return null;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function currentUserScope(signal?: AbortSignal | null): Promise<AuthScope | null> {
  if (!currentScopePromise) {
    const pending = readCurrentUserScope().finally(() => {
      if (currentScopePromise === pending) currentScopePromise = null;
    });
    currentScopePromise = pending;
  }
  return waitForCaller(currentScopePromise, signal);
}

function sharedReadTtl(path: string): number {
  return SHARED_READ_TTLS[path] ?? DEFAULT_SHARED_READ_TTL_MS;
}

function invalidateSharedReads(): void {
  sharedReadCache.clear();
}

async function performApiRequest<T>(path: string, init: RequestInit, timeoutMs: number, knownAccessToken?: string): Promise<T> {
  return requestApiResponse(path, init, timeoutMs, async (response) => {
    if (!response.ok) {
      throw new Error(messageFromBody(await readErrorBody(response), response.status));
    }
    return parseSuccess<T>(response);
  }, knownAccessToken);
}

export async function api<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...requestInit } = init;
  const method = (requestInit.method || "GET").toUpperCase();

  if (isShareableRead(path, requestInit)) {
    if (requestInit.signal?.aborted) throw makeAbortError();
    const userScope = await currentUserScope(requestInit.signal);
    if (requestInit.signal?.aborted) throw makeAbortError();
    // Every route in this allowlist is private. If the local session cannot be
    // verified, fail closed instead of repeating a potentially stalled
    // getSession() inside requestApiResponse or sending an accidental anonymous
    // request. The auth guard can then redirect/refresh the session normally.
    if (!userScope) {
      throw new Error("No se pudo verificar tu sesión. Volvé a ingresar y reintentá.");
    }

    const key = `${userScope.userId}:${safeApiUrl(path)}:${timeoutMs}`;
    let entry = sharedReadCache.get(key);
    if (entry && entry.expiresAt !== Number.POSITIVE_INFINITY && entry.expiresAt <= Date.now()) {
      sharedReadCache.delete(key);
      entry = undefined;
    }

    if (!entry) {
      // Do not bind the underlying small GET to one component's AbortSignal:
      // a sibling may still need it after navigation/Strict Mode cleanup.
      const promise = performApiRequest<T>(path, { ...requestInit, signal: undefined }, timeoutMs, userScope.accessToken);
      entry = { promise, expiresAt: Number.POSITIVE_INFINITY };
      sharedReadCache.set(key, entry);
      const storedEntry = entry;
      void promise.then(
        () => {
          if (sharedReadCache.get(key) === storedEntry) {
            storedEntry.expiresAt = Date.now() + sharedReadTtl(path);
          }
        },
        () => {
          if (sharedReadCache.get(key) === storedEntry) sharedReadCache.delete(key);
        },
      );
    }
    return waitForCaller(entry.promise as Promise<T>, requestInit.signal);
  }

  const result = await performApiRequest<T>(path, requestInit, timeoutMs);
  if (method !== "GET") invalidateSharedReads();
  return result;
}

function safeFilename(value: string, fallbackName: string): string {
  const sanitized = value
    .replace(/[\\/\u0000-\u001f\u007f]/g, "_")
    .replace(/^\.+$/, "")
    .trim()
    .slice(0, 180);
  return sanitized || fallbackName;
}

/** Download an authenticated response without exposing the access token in a URL. */
export async function downloadApiFile(path: string, fallbackName: string): Promise<void> {
  return requestApiResponse(path, { method: "GET" }, DOWNLOAD_TIMEOUT_MS, async (response) => {
    if (!response.ok) {
      throw new Error(messageFromBody(await readErrorBody(response), response.status));
    }

    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const utf8Name = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const plainName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
    let serverName = plainName || "";
    if (utf8Name) {
      try {
        serverName = decodeURIComponent(utf8Name);
      } catch {
        serverName = plainName || "";
      }
    }
    const filename = safeFilename(serverName, fallbackName);
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Give the browser enough time to consume the object URL before revoking it.
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
  });
}
