import type { EveningPhase } from '../flow/evening';
import type { InputState } from '../net/protocol';
import type { PlayerInfo } from '../net/roster';
import type { PlayerKey } from '../minigames/types';
import type { EveningProgress } from '../progress/eveningProgress';
import type { SnapPayload } from './eveningHost';
import type { KeyboardInput } from './keyboard';
import type { PointerInput } from './pointer';

export type StageTiming = { ruleMs: number; countdownMs: number; standingsMs: number };

/** Everything a scene may use; scenes only render, the host's EveningHost decides. */
export interface StageCtx {
  isHost: boolean;
  players(): PlayerInfo[];
  selfKey(): PlayerKey;
  keyboard: KeyboardInput;
  /** Mouse state: written by MinigameScene, read by the client's input send and the host's localInput. */
  pointer: PointerInput;
  timing: StageTiming;
  /** Own XP settlement; the stage feeds it every phase before showing it. */
  progress: EveningProgress;
  /** Host: latest authoritative minigame snapshot with its tick number and tick time (ms, performance.now clock). */
  hostSnapshot?(): (SnapPayload & { tick: number; at: number }) | null;
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
