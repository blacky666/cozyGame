import type { EveningPhase } from '../flow/evening';
import type { InputState } from '../net/protocol';
import type { PlayerInfo } from '../net/roster';
import type { PlayerKey } from '../minigames/types';
import type { SnapPayload } from './eveningHost';
import type { KeyboardInput } from './keyboard';

export type StageTiming = { ruleMs: number; countdownMs: number; standingsMs: number };

/** Everything a scene may use; scenes only render, the host's EveningHost decides. */
export interface StageCtx {
  isHost: boolean;
  players(): PlayerInfo[];
  selfKey(): PlayerKey;
  keyboard: KeyboardInput;
  timing: StageTiming;
  /** Host: latest authoritative minigame snapshot (rendered directly). */
  hostSnapshot?(): SnapPayload | null;
  /** Client: subscribe to minigame snapshots (null unsubscribes). */
  onSnap(cb: ((tick: number, p: SnapPayload, at: number) => void) | null): void;
  /** Client: send own input to the host; returns the seq sent (0 if none). */
  sendInput?(s: InputState): number;
  /** Host: "Nochmal?" on the podium. */
  playAgain?(): void;
  /** Ended screen: back to the start menu. */
  backToStart(): void;
}

export type SceneData<K extends EveningPhase['kind']> = { phase: Extract<EveningPhase, { kind: K }>; ctx: StageCtx };
