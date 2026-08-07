/**
 * Spatial voice over a WebRTC peer mesh.
 *
 * Scope, honestly: this is the ≤8-participant mesh from docs/gearbox/05-realtime.md
 * §5.8 — the right shape for a LAN/dev room, and the production path remains a bought
 * SFU (LiveKit) per ADR 0002 when rooms grow past mesh economics. Signaling rides the
 * session's rtc relay; the server never touches the media.
 *
 * What is faithfully implemented from the plan:
 *  - spatialization is client-side (§5.7 rule 1): each remote stream feeds a Web
 *    Audio HRTF panner positioned from that peer's interpolated pose every frame
 *  - capture is consent-first: the microphone is requested only on an explicit
 *    button press, never on load, and the button state is the indicator (§7.7)
 *  - receiving needs no mic: a peer who stays muted still hears the room
 *
 * Glare avoidance: for any pair, only the LOWER index ever creates the offer.
 */

import type { RoomSession } from './session.js';

interface Peer {
  pc: RTCPeerConnection;
  panner: PannerNode;
  /** Chrome will not route a remote track into Web Audio unless it is also attached
   * to a muted media element — a long-standing quirk, not a hack of ours. */
  keepalive: HTMLAudioElement;
  pendingCandidates: RTCIceCandidateInit[];
  hasRemoteDescription: boolean;
}

type RtcPayload =
  | { kind: 'voice-on' }
  | { kind: 'offer'; sdp: string }
  | { kind: 'answer'; sdp: string }
  | { kind: 'ice'; candidate: RTCIceCandidateInit };

export class VoiceMesh {
  private readonly peers = new Map<number, Peer>();
  private readonly voiceOn = new Set<number>();
  private context: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private micEnabled = false;

  constructor(
    private readonly session: RoomSession,
    private readonly remotePosition: (index: number) => { x: number; y: number; z: number } | null,
    private readonly listenerPose: () => {
      position: { x: number; y: number; z: number };
      forward: { x: number; y: number; z: number };
    },
  ) {}

  get enabled(): boolean {
    return this.micEnabled;
  }

  /** Explicit user action only. Returns false when the mic is unavailable/refused. */
  async enableMicrophone(): Promise<boolean> {
    if (this.micEnabled) return true;
    try {
      this.micStream ??= await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      return false;
    }
    this.micEnabled = true;
    this.ensureContext();

    for (const track of this.micStream.getAudioTracks()) track.enabled = true;
    // Announce, and (as the lower index of any pair) initiate.
    for (const index of this.session.remoteIndices()) {
      this.send(index, { kind: 'voice-on' });
      if (this.session.self < index) void this.connectTo(index);
    }
    return true;
  }

  muteMicrophone(): void {
    this.micEnabled = false;
    if (this.micStream) {
      for (const track of this.micStream.getAudioTracks()) track.enabled = false;
    }
  }

  onPeerJoin(index: number): void {
    // Late joiner: tell them our voice is on so the pair connects.
    if (this.micEnabled) {
      this.send(index, { kind: 'voice-on' });
      if (this.session.self < index) void this.connectTo(index);
    }
  }

  onPeerLeave(index: number): void {
    const peer = this.peers.get(index);
    if (peer) {
      peer.pc.close();
      peer.keepalive.srcObject = null;
      this.peers.delete(index);
    }
    this.voiceOn.delete(index);
  }

  onRtc(from: number, payload: unknown): void {
    const msg = payload as RtcPayload;
    switch (msg.kind) {
      case 'voice-on':
        this.voiceOn.add(from);
        // Lower index initiates; receiving voice-on needs no local mic to hear them.
        if (this.session.self < from) void this.connectTo(from);
        break;
      case 'offer':
        void this.onOffer(from, msg.sdp);
        break;
      case 'answer':
        void this.onAnswer(from, msg.sdp);
        break;
      case 'ice':
        void this.onIce(from, msg.candidate);
        break;
    }
  }

  /** Call every frame: positions each peer's panner and the listener. */
  updatePositions(): void {
    const ctx = this.context;
    if (!ctx) return;

    const listener = this.listenerPose();
    const l = ctx.listener;
    // positionX etc. are missing on some older WebAudio implementations.
    if (typeof l.positionX?.setValueAtTime === 'function') {
      l.positionX.value = listener.position.x;
      l.positionY.value = listener.position.y;
      l.positionZ.value = listener.position.z;
      l.forwardX.value = listener.forward.x;
      l.forwardY.value = listener.forward.y;
      l.forwardZ.value = listener.forward.z;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    }

    for (const [index, peer] of this.peers) {
      const pos = this.remotePosition(index);
      if (!pos) continue;
      peer.panner.positionX.value = pos.x;
      peer.panner.positionY.value = pos.y;
      peer.panner.positionZ.value = pos.z;
    }
  }

  dispose(): void {
    for (const [index] of this.peers) this.onPeerLeave(index);
    this.micStream?.getTracks().forEach((t) => t.stop());
    void this.context?.close();
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private ensureContext(): AudioContext {
    this.context ??= new AudioContext();
    void this.context.resume();
    return this.context;
  }

  private send(to: number, payload: RtcPayload): void {
    this.session.sendRtc(to, payload);
  }

  private peerFor(index: number): Peer {
    const existing = this.peers.get(index);
    if (existing) return existing;

    const ctx = this.ensureContext();
    const pc = new RTCPeerConnection();

    const panner = new PannerNode(ctx, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: 1,
      rolloffFactor: 1.4,
      maxDistance: 30,
    });
    panner.connect(ctx.destination);

    const keepalive = new Audio();
    keepalive.muted = true;
    keepalive.autoplay = true;

    const peer: Peer = {
      pc,
      panner,
      keepalive,
      pendingCandidates: [],
      hasRemoteDescription: false,
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) this.send(index, { kind: 'ice', candidate: event.candidate.toJSON() });
    };
    pc.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      keepalive.srcObject = stream;
      void keepalive.play().catch(() => {});
      ctx.createMediaStreamSource(stream).connect(panner);
    };

    if (this.micStream) {
      for (const track of this.micStream.getAudioTracks()) pc.addTrack(track, this.micStream);
    } else {
      // No mic: still receive their audio.
      pc.addTransceiver('audio', { direction: 'recvonly' });
    }

    this.peers.set(index, peer);
    return peer;
  }

  private async connectTo(index: number): Promise<void> {
    if (this.peers.has(index)) return;
    const peer = this.peerFor(index);
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    this.send(index, { kind: 'offer', sdp: offer.sdp ?? '' });
  }

  private async onOffer(from: number, sdp: string): Promise<void> {
    const peer = this.peerFor(from);
    await peer.pc.setRemoteDescription({ type: 'offer', sdp });
    peer.hasRemoteDescription = true;
    await this.drainCandidates(peer);
    const answer = await peer.pc.createAnswer();
    await peer.pc.setLocalDescription(answer);
    this.send(from, { kind: 'answer', sdp: answer.sdp ?? '' });
  }

  private async onAnswer(from: number, sdp: string): Promise<void> {
    const peer = this.peers.get(from);
    if (!peer) return;
    await peer.pc.setRemoteDescription({ type: 'answer', sdp });
    peer.hasRemoteDescription = true;
    await this.drainCandidates(peer);
  }

  private async onIce(from: number, candidate: RTCIceCandidateInit): Promise<void> {
    const peer = this.peers.get(from);
    if (!peer) return;
    // Candidates arriving before the remote description must queue, not throw.
    if (!peer.hasRemoteDescription) {
      peer.pendingCandidates.push(candidate);
      return;
    }
    await peer.pc.addIceCandidate(candidate).catch(() => {});
  }

  private async drainCandidates(peer: Peer): Promise<void> {
    for (const candidate of peer.pendingCandidates.splice(0)) {
      await peer.pc.addIceCandidate(candidate).catch(() => {});
    }
  }
}
