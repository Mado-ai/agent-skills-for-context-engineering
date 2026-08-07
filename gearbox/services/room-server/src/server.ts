/**
 * WebSocket host for the authoritative room.
 *
 * DEV TRANSPORT. The production plan is LiveKit data channels behind ITransport
 * (docs/gearbox/02-stack.md §2.3), with sessions minted by gearbox-core's
 * `POST /sessions` and roles resolved from environment membership
 * (docs/gearbox/06-api.md). This server exists so the realtime rules can be exercised
 * end-to-end over real sockets today: it accepts handle+role from the query string,
 * which is acceptable for a LAN dev loop and nothing else.
 *
 * All room *rules* live in @gearbox/room-core — this file is only sockets.
 */

import { createServer, type Server } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { verifyRoomToken } from '@gearbox/auth-sdk';
import {
  AuthoritativeRoom,
  type ObjectSpec,
  type RoomConnection,
  type Role,
  type SettledObject,
} from '@gearbox/room-core';

const VALID_ROLES: readonly Role[] = ['owner', 'admin', 'collaborator', 'viewer'];

/**
 * The demo room's objects mirror the viewer's collection arc
 * (apps/xr-viewer/src/main.ts) so both ends agree on ids and home poses.
 */
export function demoObjects(): ObjectSpec[] {
  const ids = ['018f-lantern', '018f-echo', '018f-compass', '018f-charm', '018f-prism'];
  return ids.map((id, i) => {
    const t = (i / (ids.length - 1)) * 2 - 1;
    return {
      id,
      position: { x: t * 2.25, y: 1.26, z: -1.75 - Math.abs(t) * 0.5 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    };
  });
}

export interface RoomServerOptions {
  port?: number;
  host?: string;
  objects?: () => ObjectSpec[];
  /**
   * When set, every join must present a valid room token minted by gearbox-core's
   * POST /v1/sessions, and handle/role/room come from its claims. When unset the
   * server runs in dev mode (query-string identity) and says so loudly.
   */
  tokenSecret?: string;
  /** Directory for room persistence. Unset = rooms are ephemeral. */
  dataDir?: string;
  saveDebounceMs?: number;
}

/** File-backed room persistence: one JSON document per room, written debounced on
 * settle. The Drizzle-backed store replaces this when the environments module lands;
 * the interface is the seam. */
export interface RoomStore {
  load(room: string): Promise<SettledObject[] | null>;
  save(room: string, objects: readonly SettledObject[]): Promise<void>;
}

export function fileRoomStore(dir: string): RoomStore {
  const fileFor = (room: string): string => join(dir, `${room}.json`);
  return {
    async load(room) {
      try {
        const raw = await readFile(fileFor(room), 'utf8');
        return JSON.parse(raw) as SettledObject[];
      } catch {
        return null;
      }
    },
    async save(room, objects) {
      await mkdir(dir, { recursive: true });
      await writeFile(fileFor(room), JSON.stringify(objects, null, 2), 'utf8');
    },
  };
}

export interface RunningRoomServer {
  port: number;
  close(): Promise<void>;
  /** Test access to a live room's authoritative state. */
  room(name: string): AuthoritativeRoom | undefined;
}

export function startRoomServer(options: RoomServerOptions = {}): Promise<RunningRoomServer> {
  const objects = options.objects ?? demoObjects;
  const rooms = new Map<string, AuthoritativeRoom>();
  const store = options.dataDir ? fileRoomStore(options.dataDir) : null;
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const debounceMs = options.saveDebounceMs ?? 500;

  if (!options.tokenSecret) {
    console.warn(
      '[room-server] DEV MODE: no ROOM_TOKEN_SECRET — identity comes from the query string. Do not expose this beyond a trusted LAN.',
    );
  }

  const scheduleSave = (room: string, settled: readonly SettledObject[]): void => {
    if (!store) return;
    const pending = saveTimers.get(room);
    if (pending) clearTimeout(pending);
    const snapshot = settled.map((o) => ({ ...o }));
    saveTimers.set(
      room,
      setTimeout(() => {
        saveTimers.delete(room);
        void store.save(room, snapshot).catch((err) => {
          console.error(`[room-server] failed to persist room "${room}":`, err);
        });
      }, debounceMs),
    );
  };

  const http: Server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', rooms: rooms.size }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server: http });

  wss.on('connection', async (ws: WebSocket, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const match = /^\/rooms\/([\w-]{1,64})$/.exec(url.pathname);
    if (!match) {
      ws.close(4004, 'unknown room path');
      return;
    }

    const roomName = match[1] as string;
    let handle: string;
    let role: Role;

    if (options.tokenSecret) {
      // Production posture: identity and role come from the token's claims only,
      // and the token is scoped to exactly this room.
      const token = url.searchParams.get('token');
      if (!token) {
        ws.close(4401, 'room token required');
        return;
      }
      try {
        const claims = await verifyRoomToken(options.tokenSecret, token);
        if (claims.room !== roomName) {
          ws.close(4403, 'token is for a different room');
          return;
        }
        handle = claims.handle.slice(0, 24);
        role = claims.role;
      } catch {
        ws.close(4401, 'invalid room token');
        return;
      }
    } else {
      handle = (url.searchParams.get('handle') ?? 'guest').slice(0, 24);
      const roleParam = url.searchParams.get('role') ?? 'collaborator';
      role = (VALID_ROLES as readonly string[]).includes(roleParam)
        ? (roleParam as Role)
        : 'viewer'; // unknown roles degrade to least privilege, never escalate
    }

    let room = rooms.get(roomName);
    if (!room) {
      const persisted = store ? await store.load(roomName) : null;
      const specs: ObjectSpec[] = persisted ?? objects();
      room = new AuthoritativeRoom(specs, undefined, {
        onSettled: (settled) => scheduleSave(roomName, settled),
      });
      rooms.set(roomName, room);
    }

    const conn: RoomConnection = {
      sendBinary: (bytes) => {
        if (ws.readyState === ws.OPEN) ws.send(bytes, { binary: true });
      },
      sendJson: (message) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
      },
    };

    const index = room.join(conn, { handle, role });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const bytes =
          data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data as Buffer);
        room.handleBinary(index, bytes);
      } else {
        try {
          room.handleJson(index, JSON.parse(String(data)));
        } catch {
          // Malformed client JSON is dropped.
        }
      }
    });

    ws.on('close', () => {
      room.leave(index);
      if (room.participantCount === 0) {
        rooms.delete(roomName);
        // Flush any pending save immediately: eviction must not lose the last state.
        const pending = saveTimers.get(roomName);
        if (pending) {
          clearTimeout(pending);
          saveTimers.delete(roomName);
        }
        if (store) {
          const settled = room.settledObjects();
          void store.save(roomName, settled).catch((err) => {
            console.error(`[room-server] failed to persist room "${roomName}" on eviction:`, err);
          });
        }
      }
    });
  });

  const ticker = setInterval(() => {
    for (const room of rooms.values()) room.tick();
  }, 1000);

  return new Promise((resolve) => {
    http.listen(options.port ?? 7777, options.host ?? '0.0.0.0', () => {
      const address = http.address();
      const port = typeof address === 'object' && address ? address.port : (options.port ?? 7777);
      resolve({
        port,
        room: (name) => rooms.get(name),
        close: () =>
          new Promise<void>((done) => {
            clearInterval(ticker);
            for (const client of wss.clients) client.terminate();
            wss.close(() => http.close(() => done()));
          }),
      });
    });
  });
}
