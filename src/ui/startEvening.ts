import type { Transport } from '../net/transport';
import type { ClientSession, HostSession } from '../net/session';
import type { Profile } from '../save/profile';

export type EveningContext = {
  session: HostSession | ClientSession;
  transport: Transport;
  profile: Profile;
  isHost: boolean;
  rounds: number;
};

/** Seam for Task 9: called when the host presses "Los geht's!". */
export function onStartEvening(ctx: EveningContext): void {
  console.info('startEvening (placeholder, Task 9)', { host: ctx.isHost, rounds: ctx.rounds });
}
