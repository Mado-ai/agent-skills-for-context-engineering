/**
 * Entry point: `pnpm --filter @gearbox/room-server dev`
 * Viewer connects with: ?server=ws://localhost:7777/rooms/demo&handle=you
 */

import { startRoomServer } from './server.js';

const port = Number(process.env.PORT ?? 7777);
const tokenSecret = process.env.ROOM_TOKEN_SECRET;
const dataDir = process.env.ROOM_DATA_DIR ?? './room-data';

startRoomServer({ port, tokenSecret, dataDir })
  .then((server) => {
    console.log(
      `[room-server] listening on :${server.port} (dev transport — see server.ts header)`,
    );
  })
  .catch((err) => {
    console.error('[room-server] failed to start:', err);
    process.exit(1);
  });
