import type { AssetFile } from '../gfx/assetTypes';
import type { PlayerInfo } from '../net/roster';
import { CONFIG } from '../config';
import { sound } from '../audio/sound';
import { LOBBY_MUSIC, OWN_SOUND, rosterChange, uiSound } from '../audio/uiSounds';
import type { Profile } from '../save/profile';
import { drawCharacter } from './charPreview';
import { nextRewardRow, showLookEditor } from './lookEditor';
import { clear, h } from './dom';
import { lobbyModel } from './lobbyModel';
import { GAME_CATALOG } from '../minigames/catalog';

export type LobbyOptions = {
  code: string;
  selfId: string;
  isHost: boolean;
  rounds: number;
  assets: Record<string, AssetFile> | null;
  onReady(ready: boolean): void;
  onRounds(n: number): void;
  onStart(): void;
  onLeave(): void;
  /** Host only: minigames in the rotation (ids) and the callback when the choice changes. */
  games?: readonly string[];
  onGames?(ids: string[]): void;
  /** Host only: remove another player from the lobby. */
  onKick?(playerId: string): void;
  /** Own profile (next reward, look editor). */
  profile: Profile;
  /** The look was changed in the editor (the caller saves and tells the host). */
  onProfile(p: Profile): void;
};

export type Lobby = {
  /** Call on each roster change. */
  update(roster: PlayerInfo[]): void;
  /** The own profile changed outside the lobby (after an evening): refresh, close the editor. */
  setProfile(p: Profile): void;
};

/** Renders the lobby; returns its updaters (roster, own profile). */
export function showLobby(root: HTMLElement, o: LobbyOptions, initial: PlayerInfo[]): Lobby {
  clear(root);
  let profile = o.profile;
  let selfSlot = 0;
  const own = h('div', { class: 'cg-own' });
  let closeEditor: (() => void) | null = null;
  const openEditor = () => {
    closeEditor?.();
    const host = h('div');
    const overlay = h(
      'div',
      { class: 'cg-overlay', role: 'dialog' },
      h(
        'div',
        { class: 'cg-panel cg-dialog cg-editor-dialog' },
        h('h2', { class: 'cg-h2', text: 'Aussehen' }),
        host,
        h('button', { class: 'cg-btn', text: 'Fertig', onclick: () => closeEditor?.() }),
      ),
    );
    const cleanup = showLookEditor(host, {
      profile, assets: o.assets, slot: selfSlot,
      onChange: (p) => {
        profile = { ...profile, look: p.look };
        o.onProfile(profile);
      },
    });
    closeEditor = () => {
      cleanup();
      overlay.remove();
      closeEditor = null;
    };
    root.append(overlay);
  };
  const renderOwn = () => {
    clear(own);
    own.append(
      nextRewardRow(profile.xp, o.assets),
      h('button', { class: 'cg-btn cg-secondary', text: 'Aussehen ändern', onclick: openEditor }),
    );
  };
  renderOwn();
  sound.setMusic(LOBBY_MUSIC);
  const slotsEl = h('div', { class: 'cg-slots' });
  const hint = h('p', { class: 'cg-hint' });
  const readyBtn = h('button', { class: 'cg-btn cg-ok', [OWN_SOUND]: true });
  const startBtn = h('button', { class: 'cg-btn', text: "Los geht's!", onclick: o.onStart });
  let selfReady = false;
  readyBtn.addEventListener('click', () => {
    uiSound(selfReady ? 'nicht_bereit' : 'bereit');
    o.onReady(!selfReady);
  });

  const copy = h('button', {
    class: 'cg-btn cg-secondary', text: 'Kopieren', [OWN_SOUND]: true,
    onclick: () => {
      void navigator.clipboard?.writeText(o.code).then(() => {
        uiSound('kopiert');
        copy.textContent = 'Kopiert!';
        setTimeout(() => (copy.textContent = 'Kopieren'), 1500);
      });
    },
  });
  const rounds = h('select', { class: 'cg-input', 'aria-label': 'Runden', onchange: () => o.onRounds(Number(rounds.value)) });
  for (let n = CONFIG.rounds.min; n <= CONFIG.rounds.max; n++) {
    const opt = h('option', { value: n, text: `${n} Runden` });
    opt.selected = n === o.rounds;
    rounds.append(opt);
  }

  // Host: which games are in the rotation (at least one stays on).
  let chosen = new Set(o.games ?? GAME_CATALOG.map((g) => g.id));
  const boxes = GAME_CATALOG.map((g) => {
    const box = h('input', { type: 'checkbox', 'aria-label': g.title });
    box.checked = chosen.has(g.id);
    box.addEventListener('change', () => {
      const next = new Set(chosen);
      if (box.checked) next.add(g.id);
      else next.delete(g.id);
      if (next.size === 0) {
        box.checked = true;
        hint.textContent = 'Mindestens ein Spiel muss dabei sein.';
        return;
      }
      chosen = next;
      o.onGames?.(GAME_CATALOG.filter((x) => chosen.has(x.id)).map((x) => x.id));
    });
    return h('label', { class: 'cg-game' }, box, h('span', { text: g.title }));
  });
  const gamesRow = o.isHost
    ? h('div', { class: 'cg-games' }, h('span', { class: 'cg-label', text: 'Spiele:' }), ...boxes)
    : null;

  root.append(
    h(
      'div',
      { class: 'cg-screen' },
      h(
        'div',
        { class: 'cg-panel cg-wide' },
        h('p', { class: 'cg-label', text: 'Raumcode' }),
        h('div', { class: 'cg-row' }, h('div', { class: 'cg-code', text: o.code }), copy),
        slotsEl,
        own,
        gamesRow,
        hint,
        h(
          'div',
          { class: 'cg-row' },
          readyBtn,
          o.isHost ? rounds : null,
          o.isHost ? startBtn : null,
          h('button', { class: 'cg-btn cg-secondary', text: 'Raum verlassen', onclick: o.onLeave }),
        ),
      ),
    ),
  );

  let present: string[] | null = null;
  const update = (roster: PlayerInfo[]): void => {
    const now = roster.filter((p) => p.connected).map((p) => p.id);
    if (present) {
      const { joined, left } = rosterChange(present, now);
      if (joined > 0) uiSound('spieler_kommt');
      else if (left > 0) uiSound('spieler_geht');
    }
    present = now;
    const m = lobbyModel(roster, o.selfId, o.isHost, o.rounds);
    selfSlot = roster.find((p) => p.id === o.selfId)?.slot ?? selfSlot;
    selfReady = roster.find((p) => p.id === o.selfId)?.ready ?? false;
    readyBtn.textContent = selfReady ? 'Nicht bereit' : 'Bereit';
    startBtn.disabled = !m.canStart;
    hint.textContent = o.isHost ? m.startHint : 'Der Gastgeber startet den Abend.';
    clear(slotsEl);
    m.slots.forEach((s, i) => {
      if (!s) {
        slotsEl.append(h('div', { class: 'cg-slot empty' }, h('span', { class: 'cg-sub', text: 'Frei' })));
        return;
      }
      slotsEl.append(
        h(
          'div',
          { class: `cg-slot${s.isSelf ? ' self' : ''}` },
          o.assets ? drawCharacter(s.look, i, o.assets) : null,
          h('span', { class: 'cg-name', text: s.name }),
          h('span', { class: 'cg-sub', text: `Level ${s.level ?? 1}${(s.stars ?? 0) > 0 ? ` · ★ ${s.stars}` : ''}` }),
          h('span', { class: 'cg-ready', text: !s.connected ? 'getrennt' : s.ready ? '✓ Bereit' : '' }),
          o.isHost && o.onKick && !s.isSelf && !s.isBot
            ? h('button', {
                class: 'cg-kick', text: 'Entfernen', title: `${s.name} aus dem Raum entfernen`,
                onclick: () => {
                  if (confirm(`${s.name} wirklich aus dem Raum entfernen?`)) o.onKick?.(s.id);
                },
              })
            : null,
        ),
      );
    });
  };
  update(initial);
  return {
    update,
    setProfile(p) {
      closeEditor?.();
      profile = p;
      renderOwn();
    },
  };
}
