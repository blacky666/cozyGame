import { joinRoom, selfId } from 'trystero';
import { CONFIG } from '../config';
import type { Transport } from './transport';
import { MSG_TYPES } from './protocol';
import { normalizeRoomCode } from './roomCode';

// Trystero 0.25 API: onPeerJoin/onPeerLeave/onMessage are properties,
// action.send(data, { target }) returns a promise.
export function joinTrysteroRoom(rawCode: string): Transport {
  const code = normalizeRoomCode(rawCode);
  if (code === null) throw new Error(`Invalid room code: ${rawCode}`);
  const iceServers: RTCIceServer[] = CONFIG.net.stun.map((urls) => ({ urls }));
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

  for (const type of MSG_TYPES) getAction(type);
  let left = false;

  room.onPeerJoin = (id) => joinCbs.forEach((cb) => cb(id));
  room.onPeerLeave = (id) => leaveCbs.forEach((cb) => cb(id));

  return {
    selfId,
    send(type, data, to) {
      if (left) return;
      getAction(type)
        .send(data as never, to !== undefined ? { target: to } : undefined)
        .catch((e) => console.warn('send failed', type, e));
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
      if (left) return;
      left = true;
      void room.leave();
    },
  };
}
