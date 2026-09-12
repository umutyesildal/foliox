/**
 * Single validated client for the Basalt backend (backend/src/api/server.ts).
 *
 * Every app fetch of the basket API goes through `apiFetch` (or `apiQuery`,
 * its query-string variant) so the request URL is never assembled directly
 * from request-derived input:
 *
 *   1. the path must literally start with `/api/v1/`;
 *   2. the final URL is built with `new URL(path, API_BASE)` and its origin
 *      must equal the configured API origin — a path cannot retarget the
 *      host (protocol-relative `//host` or absolute-URL paths fail check 1);
 *   3. cleartext `http:` is restricted to loopback / localhost / private-LAN
 *      hosts (development + staging); production uses `https:`.
 */

export const API_BASE: string = process.env.NEXT_PUBLIC_API || "http://localhost:3001";

/** Only versioned API paths may be fetched. */
const API_PATH_RE = /^\/api\/v1\//;

/**
 * Hosts for which cleartext http: is allowed: loopback names/addresses and
 * RFC1918 private-LAN addresses (10/8, 172.16/12, 192.168/16) + *.local.
 */
const LOCAL_HTTP_HOST_RE =
  /^(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[::1\]|::1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|[a-z0-9-]*\.local)$/i;

/** Throws unless `url` is an https: URL or an http: URL on a local/LAN host. */
function assertTrustedUrl(url: URL): void {
  if (url.protocol === "https:") return;
  if (url.protocol === "http:" && LOCAL_HTTP_HOST_RE.test(url.hostname)) return;
  throw new Error(
    `apiFetch: refusing to fetch non-https, non-local URL ${url.toString()}`,
  );
}

/** Validated absolute API URL for a `/api/v1/...` path. */
function toApiUrl(path: string): URL {
  if (!API_PATH_RE.test(path)) {
    throw new Error(`apiFetch: path must start with /api/v1/ — got ${JSON.stringify(path.slice(0, 64))}`);
  }
  let url: URL;
  try {
    url = new URL(path, API_BASE);
  } catch {
    throw new Error(`apiFetch: could not resolve API URL for ${JSON.stringify(path.slice(0, 64))}`);
  }
  // The path check above already rules out host-retargeting inputs, but assert
  // the origin explicitly so the guarantee does not depend on URL quirks.
  const baseOrigin = new URL(API_BASE).origin;
  if (url.origin !== baseOrigin) {
    throw new Error(`apiFetch: resolved URL origin ${url.origin} does not match API origin ${baseOrigin}`);
  }
  assertTrustedUrl(url);
  return url;
}

/**
 * Fetch a backend API route. `path` must be a `/api/v1/...` path (literal at
 * every call site; dynamic values go through encodeURIComponent or
 * `apiQuery`). `init` is passed through untouched (signal, cache, headers,
 * method, body).
 */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(toApiUrl(path), init);
}

/**
 * `apiFetch` variant for routes with query parameters: `path` stays a literal
 * `/api/v1/...` route and `params` are encoded via URLSearchParams, so no
 * request-derived value is ever concatenated into the fetched URL string.
 */
export function apiQuery(
  path: string,
  params: Record<string, string>,
  init?: RequestInit,
): Promise<Response> {
  const url = toApiUrl(path);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  assertTrustedUrl(url);
  return fetch(url, init);
}
