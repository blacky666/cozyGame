import { joinRoom, selfId } from 'trystero';
import { CONFIG } from '../config';
import type { Transport } from './transport';

// Trystero 0.25 API: onPeerJoin/onPeerLeave/onMessage are properties,
// action.send(data, { target }) returns a promise.
export function joinTrysteroRoom(code: string): Transport {
  const iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];
  if (CONFIG.turn.urls.length > 0) {
    iceServers.push({
      urls: [...CONFIG.turn.urls],
      username: CONFIG.turn.username,
      credential: CONFIG.turn.credential,
    });
  }
  const room = joinRoom({ appId: CONFIG.net.appId, rtcConfig: { iceServers } }, `${CONFIG.net.appId}:${code}`);

  type Handler = (data: unknown, from: string) => void;
  const handlers = new Map<string, Handler[]>();
  type Action = {
    send: (data: never, options?: { target?: string }) => Promise<void>;
    onMessage: ((data: unknown, ctx: { peerId: string }) => void) | null;
  };
  const actions = new Map<string, Action>();
  const joinCbs: Array<(id: string) => void> = [];
  const leaveCbs: Array<(id: string) => void> = [];

  const getAction = (type: string) => {
    const existing = actions.get(type);
    if (existing) return existing;
    const a = room.makeAction(type, { kind: 'message' }) as unknown as Action;
    a.onMessage = (data, { peerId }) => {
      handlers.get(type)?.forEach((cb) => cb(data, peerId));
    };
    actions.set(type, a);
    return a;
  };

  room.onPeerJoin = (id) => joinCbs.forEach((cb) => cb(id));
  room.onPeerLeave = (id) => leaveCbs.forEach((cb) => cb(id));

  return {
    selfId,
    send(type, data, to) {
      void getAction(type).send(data as never, to !== undefined ? { target: to } : undefined);
    },
    on(type, cb) {
      const list = handlers.get(type) ?? [];
      list.push(cb);
      handlers.set(type, list);
      getAction(type);
    },
    onPeerJoin(cb) {
      joinCbs.push(cb);
    },
    onPeerLeave(cb) {
      leaveCbs.push(cb);
    },
    leave() {
      void room.leave();
    },
  };
}
