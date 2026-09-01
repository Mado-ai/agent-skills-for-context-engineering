import type { IncomingMessage, ServerResponse } from 'node:http';
import { RuntimeError, newTraceId } from '../domain/index.js';

/**
 * A small router.
 *
 * Deliberately dependency-free: the API surface is thin, and a framework would
 * add more configuration than it removes. Every response goes through
 * `sendJson`, and every failure through one error shape.
 */

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
  /** Who is acting. In v0.4 this is asserted, not authenticated. */
  actor: { type: 'owner' | 'agent' | 'system'; id: string };
  traceId: string;
}

export type Handler = (ctx: RequestContext) => Promise<unknown> | unknown;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: Handler): this {
    this.routes.push({ method, segments: path.split('/').filter(Boolean), handler });
    return this;
  }

  get(path: string, handler: Handler): this {
    return this.add('GET', path, handler);
  }
  post(path: string, handler: Handler): this {
    return this.add('POST', path, handler);
  }
  patch(path: string, handler: Handler): this {
    return this.add('PATCH', path, handler);
  }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i++) {
        const segment = route.segments[i]!;
        const value = parts[i]!;
        if (segment.startsWith(':')) {
          params[segment.slice(1)] = decodeURIComponent(value);
        } else if (segment !== value) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params };
    }
    return null;
  }

  list(): { method: string; path: string }[] {
    return this.routes.map((r) => ({ method: r.method, path: `/${r.segments.join('/')}` }));
  }
}

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

export function sendError(res: ServerResponse, err: unknown, traceId: string): void {
  if (err instanceof RuntimeError) {
    sendJson(res, err.httpStatus, {
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        trace_id: err.traceId ?? traceId,
      },
    });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  sendJson(res, 500, {
    error: { code: 'INTERNAL', message, details: {}, trace_id: traceId },
  });
}

const MAX_BODY_BYTES = 1_000_000;

export async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) {
      throw new RuntimeError('VALIDATION_FAILED', 'request body exceeds 1MB', { max_bytes: MAX_BODY_BYTES });
    }
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (raw === '') return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new RuntimeError('VALIDATION_FAILED', 'request body must be a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof RuntimeError) throw err;
    throw new RuntimeError('VALIDATION_FAILED', 'request body is not valid JSON');
  }
}

export function newRequestTrace(): string {
  return newTraceId();
}

/** Required string field, with a message that names the field. */
export function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RuntimeError('VALIDATION_FAILED', `"${field}" is required and must be a non-empty string`, { field });
  }
  return value;
}

export function optionalString(body: Record<string, unknown>, field: string): string | null {
  const value = body[field];
  return typeof value === 'string' && value !== '' ? value : null;
}
