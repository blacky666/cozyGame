export interface Transport {
  selfId: string;
  send(type: string, data: unknown, to?: string): void;
  on(type: string, cb: (data: unknown, from: string) => void): void;
  onPeerJoin(cb: (id: string) => void): void;
  onPeerLeave(cb: (id: string) => void): void;
  leave(): void;
}

type Handler = (data: unknown, from: string) => void;

interface LocalPeer {
  id: string;
  handlers: Map<string, Handler[]>;
  joinCbs: Array<(id: string) => void>;
  leaveCbs: Array<(id: string) => void>;
}

/** In-memory hub for tests and bots. Delivery is async (microtask) and ordered. */
export function createLocalHub(): { join(): Transport } {
  const peers = new Map<string, LocalPeer>();
  let counter = 0;

  return {
    join(): Transport {
      const me: LocalPeer = { id: `local-${++counter}`, handlers: new Map(), joinCbs: [], leaveCbs: [] };
      let left = false;
      const existing = [...peers.keys()];
      for (const p of peers.values()) p.joinCbs.forEach((cb) => cb(me.id));
      // Symmetric: the new peer learns about existing peers (async, so callbacks can be registered first).
      for (const id of existing) queueMicrotask(() => { if (!left) me.joinCbs.forEach((cb) => cb(id)); });
      peers.set(me.id, me);

      const deliver = (target: LocalPeer, type: string, data: unknown) => {
        queueMicrotask(() => {
          if (!peers.has(target.id)) return;
          target.handlers.get(type)?.forEach((cb) => cb(data, me.id));
        });
      };

      return {
        selfId: me.id,
        send(type, data, to) {
          if (left) return;
          if (to !== undefined) {
            const t = peers.get(to);
            if (t && t !== me) deliver(t, type, data);
            return;
          }
          for (const p of peers.values()) if (p !== me) deliver(p, type, data);
        },
        on(type, cb) {
          const list = me.handlers.get(type) ?? [];
          list.push(cb);
          me.handlers.set(type, list);
        },
        onPeerJoin(cb) {
          me.joinCbs.push(cb);
        },
        onPeerLeave(cb) {
          me.leaveCbs.push(cb);
        },
        leave() {
          if (left) return;
          left = true;
          peers.delete(me.id);
          for (const p of peers.values()) p.leaveCbs.forEach((cb) => cb(me.id));
        },
      };
    },
  };
}
