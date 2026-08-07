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
import { WebSocketServer, type WebSocket } from 'ws';
import {
  AuthoritativeRoom,
  type ObjectSpec,
  type RoomConnection,
  type Role,
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

  wss.on('connection', (ws: WebSocket, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const match = /^\/rooms\/([\w-]{1,64})$/.exec(url.pathname);
    if (!match) {
      ws.close(4004, 'unknown room path');
      return;
    }

    const roomName = match[1] as string;
    const handle = (url.searchParams.get('handle') ?? 'guest').slice(0, 24);
    const roleParam = url.searchParams.get('role') ?? 'collaborator';
    const role: Role = (VALID_ROLES as readonly string[]).includes(roleParam)
      ? (roleParam as Role)
      : 'viewer'; // unknown roles degrade to least privilege, never escalate

    let room = rooms.get(roomName);
    if (!room) {
      room = new AuthoritativeRoom(objects());
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
      if (room.participantCount === 0) rooms.delete(roomName);
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
