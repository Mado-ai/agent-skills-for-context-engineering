import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Runtime } from '../runtime.js';
import { RuntimeError } from '../domain/index.js';
import { Router, newRequestTrace, readBody, sendError, sendJson } from './http.js';
import { registerRegistryRoutes } from './routes/registry.js';
import { registerWorkRoutes } from './routes/work.js';
import { registerGovernanceRoutes } from './routes/governance.js';

/**
 * HTTP surface for the runtime and the Control Center.
 *
 * On authentication, stated plainly: there is none in v0.4 beyond an optional
 * shared bearer token, and the acting identity is asserted by a header rather
 * than proven. The server therefore binds to loopback by default and refuses
 * to bind elsewhere without a token. Real Owner authentication is the first
 * item in the production blockers list.
 */

const UI_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '../ui');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export interface ServerOptions {
  runtime: Runtime;
  port?: number;
  host?: string;
  /** When set, every request must present `Authorization: Bearer <token>`. */
  apiToken?: string | null;
}

export function buildRouter(runtime: Runtime): Router {
  const router = new Router();
  registerRegistryRoutes(router, runtime);
  registerWorkRoutes(router, runtime);
  registerGovernanceRoutes(router, runtime);
  router.get('/api/routes', () => ({ routes: router.list() }));
  return router;
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<boolean> {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  // Contain the served path inside the UI directory.
  const target = normalize(join(UI_DIR, relative));
  if (!target.startsWith(UI_DIR)) return false;
  try {
    const content = await readFile(target);
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(target)] ?? 'application/octet-stream',
      'content-length': content.length,
      'cache-control': 'no-cache',
    });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

export function createApiServer(options: ServerOptions): {
  server: Server;
  router: Router;
  listen(): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
} {
  const { runtime } = options;
  const router = buildRouter(runtime);
  const host = options.host ?? process.env.WORKFORCE_HOST ?? '127.0.0.1';
  const port = options.port ?? Number(process.env.WORKFORCE_PORT ?? 8787);
  const apiToken = options.apiToken ?? process.env.WORKFORCE_API_TOKEN ?? null;

  if (host !== '127.0.0.1' && host !== 'localhost' && !apiToken) {
    throw new Error(
      `refusing to bind to ${host} without WORKFORCE_API_TOKEN: v0.4 has no Owner authentication, ` +
        'so a non-loopback bind would expose approval endpoints to the network.',
    );
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res);
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const traceId = newRequestTrace();
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    try {
      if (apiToken) {
        const header = req.headers.authorization ?? '';
        if (header !== `Bearer ${apiToken}`) {
          sendJson(res, 401, {
            error: { code: 'DENIED_DEFAULT', message: 'missing or invalid bearer token', details: {}, trace_id: traceId },
          });
          return;
        }
      }

      if (!url.pathname.startsWith('/api/')) {
        const served = await serveStatic(url.pathname, res);
        if (served) return;
        sendJson(res, 404, {
          error: { code: 'NOT_FOUND', message: `no route for ${url.pathname}`, details: {}, trace_id: traceId },
        });
        return;
      }

      const match = router.match(req.method ?? 'GET', url.pathname);
      if (!match) {
        sendJson(res, 404, {
          error: {
            code: 'NOT_FOUND',
            message: `no route for ${req.method} ${url.pathname}`,
            details: {},
            trace_id: traceId,
          },
        });
        return;
      }

      const body = await readBody(req);
      const actorType = (req.headers['x-workforce-actor-type'] as string | undefined) ?? 'owner';
      const actorId = (req.headers['x-workforce-actor-id'] as string | undefined) ?? 'owner';

      const result = await match.handler({
        req,
        res,
        params: match.params,
        query: url.searchParams,
        body,
        actor: {
          type: actorType === 'agent' ? 'agent' : actorType === 'system' ? 'system' : 'owner',
          id: actorId,
        },
        traceId,
      });

      if (res.writableEnded) return;
      sendJson(res, req.method === 'POST' ? 200 : 200, result ?? { ok: true });
    } catch (err) {
      if (res.writableEnded) return;
      if (!(err instanceof RuntimeError)) {
        runtime.audit.append({
          kind: 'api.error',
          actor_type: 'system',
          trace_id: traceId,
          severity: 'error',
          payload: { path: url.pathname, message: (err as Error).message },
        });
      }
      sendError(res, err, traceId);
    }
  }

  return {
    server,
    router,
    listen() {
      return new Promise((resolvePromise) => {
        server.listen(port, host, () => {
          const address = server.address();
          const boundPort = typeof address === 'object' && address ? address.port : port;
          resolvePromise({ host, port: boundPort });
        });
      });
    },
    close() {
      return new Promise((resolvePromise) => {
        server.close(() => resolvePromise());
      });
    },
  };
}
