import { CONFIG } from '../../config';
import { playerKey, type MiniGame } from '../types';
import { createSandboxHost, lerpSandbox, sandboxBotView, type SandboxState } from './sandboxHost';
import { SandboxView } from './sandboxView';

/** Placeholder minigame until Plan 2: walk around and collect coins. */
export const sandbox: MiniGame<SandboxState> = {
  id: 'muenzjagd',
  title: 'Münzjagd',
  rule: 'Sammle so viele Münzen wie möglich! Wer geschubst wird, verliert eine.',
  controls: 'WASD – laufen · Leertaste – schubsen',
  durationMs: CONFIG.sandbox.durationMs,
  createHost: (players, rand, opts) =>
    createSandboxHost(
      players.map((p) => playerKey(p.slot)),
      rand,
      opts?.durationMs ?? CONFIG.sandbox.durationMs,
    ),
  createView: (scene, players, selfKey) => new SandboxView(scene, players, selfKey),
  lerp: lerpSandbox,
  botView: sandboxBotView,
};
