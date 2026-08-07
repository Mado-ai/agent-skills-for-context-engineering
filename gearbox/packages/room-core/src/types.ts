/**
 * Types for the authoritative room (docs/gearbox/05-realtime.md).
 *
 * This package is pure logic with no I/O: the node room-server hosts it behind
 * WebSockets, the tests drive it synchronously, and the browser demo runs it in-page
 * over a direct link. One implementation of the rules, three hosts — which is the
 * only way "the demo shows the real thing" stays true.
 */

import type { Quat, Vec3 } from '@gearbox/protocol';

export type Role = 'owner' | 'admin' | 'collaborator' | 'viewer';

export interface ObjectSpec {
  /** Stable id (matches the collected item id on the client). */
  readonly id: string;
  readonly position: Vec3;
  readonly rotation: Quat;
}

export interface JoinInfo {
  readonly handle: string;
  readonly role: Role;
}

/** The server→client half of a connection. Transport-agnostic by design. */
export interface RoomConnection {
  sendBinary(bytes: Uint8Array): void;
  sendJson(message: ServerMessage): void;
}

export interface SnapshotObject {
  index: number;
  id: string;
  position: [number, number, number];
  rotation: [number, number, number, number];
  epoch: number;
  holder: number | null;
}

export interface SnapshotParticipant {
  index: number;
  handle: string;
  role: Role;
}

/**
 * Late join receives current state, never a replay (docs/gearbox/05-realtime.md §5.5).
 */
export interface SnapshotMessage {
  type: 'welcome' | 'snapshot';
  selfIndex: number;
  seq: number;
  participants: SnapshotParticipant[];
  objects: SnapshotObject[];
}

export type ServerMessage =
  | SnapshotMessage
  | { type: 'participant_join'; index: number; handle: string; role: Role }
  | { type: 'participant_leave'; index: number }
  | {
      type: 'denied';
      action: 'ownership' | 'transform';
      objectId: number;
      reason: 'role' | 'held' | 'unknown_object';
    }
  | { type: 'rtc'; from: number; payload: unknown }
  | { type: 'error'; detail: string };

export type ClientJsonMessage = { type: 'resync' } | { type: 'rtc'; to: number; payload: unknown };

/** Durable object state handed to the persistence hook on every release. */
export interface SettledObject {
  id: string;
  position: Vec3;
  rotation: Quat;
}

export interface RoomOptions {
  /**
   * Called whenever an object settles (manual release, lease expiry, disconnect).
   * The room-server persists these so a room survives its last participant leaving
   * (docs/gearbox/05-realtime.md §5.6 — final pose on release, never the stream).
   */
  onSettled?: (objects: readonly SettledObject[]) => void;
}

export interface ParticipantStats {
  poseViolations: number;
  droppedTransforms: number;
  deniedOwnership: number;
  malformedPackets: number;
}
