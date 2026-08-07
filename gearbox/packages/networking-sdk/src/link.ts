/**
 * Client-side link abstraction (the seam from docs/gearbox/05-realtime.md §5.2).
 *
 * A link carries protocol frames (binary) and control messages (JSON). The production
 * path is LiveKit data channels; this SDK ships a WebSocket implementation for the
 * dev room-server and lets the in-page demo substitute a direct in-memory link.
 * Nothing above this interface knows which transport is in use.
 */

export interface ClientLink {
  send(bytes: Uint8Array): void;
  sendJson(message: unknown): void;
  onBinary(cb: (bytes: Uint8Array) => void): void;
  onJson(cb: (message: unknown) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

/** Browser WebSocket link. Resolves once the socket is open. */
export function connectWebSocket(url: string): Promise<ClientLink> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    const binaryCbs: Array<(b: Uint8Array) => void> = [];
    const jsonCbs: Array<(m: unknown) => void> = [];
    const closeCbs: Array<() => void> = [];

    ws.onopen = () =>
      resolve({
        send: (bytes) => ws.send(bytes),
        sendJson: (message) => ws.send(JSON.stringify(message)),
        onBinary: (cb) => binaryCbs.push(cb),
        onJson: (cb) => jsonCbs.push(cb),
        onClose: (cb) => closeCbs.push(cb),
        close: () => ws.close(),
      });

    ws.onerror = () => reject(new Error(`WebSocket connection failed: ${url}`));
    ws.onclose = () => closeCbs.forEach((cb) => cb());
    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const parsed: unknown = JSON.parse(event.data);
          jsonCbs.forEach((cb) => cb(parsed));
        } catch {
          // Malformed server JSON is dropped, never thrown into the render loop.
        }
      } else {
        const bytes = new Uint8Array(event.data as ArrayBuffer);
        binaryCbs.forEach((cb) => cb(bytes));
      }
    };
  });
}
