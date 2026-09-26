import { WATCH_REQUEST_MAX_BYTES, WatchRequestValidationError } from './watch-backend-validation.js';
import { WatchAuthorizationError } from './watch-service.js';

export const WATCH_POSSESSION_TOKEN_HEADER = 'x-sirento-possession-token';
export const WATCH_CREATE_RATE_LIMIT_SECONDS = 60;
const WATCH_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function errorResponse(status, code, message, headers) {
  return json(status, { error: { code, message } }, headers);
}

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': `content-type, ${WATCH_POSSESSION_TOKEN_HEADER}`,
    'access-control-max-age': '86400',
    vary: 'Origin'
  };
}

async function requestJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) {
    return { response: errorResponse(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json') };
  }
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > WATCH_REQUEST_MAX_BYTES) {
    return { response: errorResponse(413, 'REQUEST_TOO_LARGE', 'Request body exceeds 16 KiB') };
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > WATCH_REQUEST_MAX_BYTES) {
    return { response: errorResponse(413, 'REQUEST_TOO_LARGE', 'Request body exceeds 16 KiB') };
  }
  try {
    return { value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { response: errorResponse(400, 'MALFORMED_JSON', 'Request body must be valid JSON') };
  }
}

function route(url) {
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length === 1 && segments[0] === 'watches') return { kind: 'collection' };
  if (segments.length === 2 && segments[0] === 'watches' && WATCH_ID_PATTERN.test(segments[1])) {
    return { kind: 'watch', id: segments[1] };
  }
  return null;
}

export function createWatchApi({ service, allowedOrigins, createRateLimiter = null }) {
  if (!service) throw new TypeError('A watch service is required');
  const origins = new Set(allowedOrigins || []);

  return async function handleWatchRequest(request) {
    const origin = request.headers.get('origin') || '';
    if (!origins.has(origin)) {
      return errorResponse(403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed', { vary: 'Origin' });
    }
    const cors = corsHeaders(origin);
    const target = route(new URL(request.url));
    if (!target) return errorResponse(404, 'NOT_FOUND', 'Route not found', cors);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (request.method === 'POST' && target.kind === 'collection') {
        if (!createRateLimiter?.limit) {
          return errorResponse(503, 'RATE_LIMIT_UNAVAILABLE', 'Watch creation is temporarily unavailable', cors);
        }
        const actor = request.headers.get('cf-connecting-ip') || origin;
        const rateLimit = await createRateLimiter.limit({ key: `watch-create:${actor}` });
        if (!rateLimit?.success) {
          return errorResponse(429, 'RATE_LIMITED', 'Too many watch creation requests', {
            ...cors,
            'retry-after': String(WATCH_CREATE_RATE_LIMIT_SECONDS)
          });
        }
        const parsed = await requestJson(request);
        if (parsed.response) return withCors(parsed.response, cors);
        return json(201, await service.createWatch(parsed.value), cors);
      }
      if (request.method === 'PATCH' && target.kind === 'watch') {
        const parsed = await requestJson(request);
        if (parsed.response) return withCors(parsed.response, cors);
        const result = await service.updateWatch(target.id, request.headers.get(WATCH_POSSESSION_TOKEN_HEADER), parsed.value);
        if (!result) return errorResponse(404, 'WATCH_NOT_FOUND', 'Watch not found or token invalid', cors);
        return json(200, result, cors);
      }
      if (request.method === 'DELETE' && target.kind === 'watch') {
        await service.deleteWatch(target.id, request.headers.get(WATCH_POSSESSION_TOKEN_HEADER));
        return new Response(null, { status: 204, headers: cors });
      }
      const allow = target.kind === 'collection' ? 'POST, OPTIONS' : 'PATCH, DELETE, OPTIONS';
      return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed', { ...cors, allow });
    } catch (error) {
      if (error instanceof WatchRequestValidationError) {
        return errorResponse(400, error.code, 'Watch subscription request is invalid', cors);
      }
      if (error instanceof WatchAuthorizationError) {
        if (request.method === 'DELETE') return new Response(null, { status: 204, headers: cors });
        return errorResponse(404, 'WATCH_NOT_FOUND', 'Watch not found or token invalid', cors);
      }
      return errorResponse(503, 'BACKEND_UNAVAILABLE', 'Watch service is temporarily unavailable', cors);
    }
  };
}

function withCors(response, cors) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(cors)) headers.set(name, value);
  return new Response(response.body, { status: response.status, headers });
}
