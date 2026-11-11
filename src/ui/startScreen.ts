import { CONFIG } from '../config';
import { normalizeRoomCode } from '../net/roomCode';
import { versionLabel } from '../version';
import { clear, h } from './dom';

export type StartHandlers = {
  name: string;
  message?: string;
  onName(name: string): void;
  onCreate(): void;
  onJoin(code: string): void;
  onProfile(): void;
};

export function showStart(root: HTMLElement, o: StartHandlers): void {
  clear(root);
  const error = h('p', { class: 'cg-error', text: o.message ?? '' });
  const name = h('input', {
    class: 'cg-input', maxlength: CONFIG.players.maxName, value: o.name, placeholder: 'Dein Name', 'aria-label': 'Name',
    oninput: () => o.onName(name.value.trim().slice(0, 16)),
  });
  const code = h('input', {
    class: 'cg-input', placeholder: 'Code, z. B. KAESE-42', 'aria-label': 'Raumcode', autocomplete: 'off',
  });
  const requireName = (): boolean => {
    if (name.value.trim()) return true;
    error.textContent = 'Bitte gib zuerst deinen Namen ein.';
    name.focus();
    return false;
  };
  const join = () => {
    if (!requireName()) return;
    if (normalizeRoomCode(code.value) === null) {
      error.textContent = 'Ungültiger Code – z. B. KAESE-42';
      return;
    }
    o.onJoin(code.value);
  };
  code.addEventListener('keydown', (e) => e.key === 'Enter' && join());
  root.append(
    h(
      'div',
      { class: 'cg-screen' },
      h(
        'div',
        { class: 'cg-panel' },
        h('h1', { class: 'cg-title', text: 'cozyGame' }),
        h('label', { class: 'cg-label', text: 'Dein Name' }),
        name,
        h('button', { class: 'cg-btn', text: 'Raum erstellen', onclick: () => requireName() && o.onCreate() }),
        h('div', { class: 'cg-row' }, code, h('button', { class: 'cg-btn cg-secondary', text: 'Beitreten', onclick: join })),
        error,
        h('button', { class: 'cg-btn cg-secondary', text: 'Profil', onclick: o.onProfile }),
      ),
    ),
    h('p', { class: 'cg-version', text: versionLabel() }),
  );
}

export function showConnecting(root: HTMLElement, onCancel: () => void): void {
  clear(root);
  root.append(
    h(
      'div',
      { class: 'cg-screen' },
      h(
        'div',
        { class: 'cg-panel' },
        h('p', { class: 'cg-h2', text: 'Verbinde …' }),
        h('button', { class: 'cg-btn cg-secondary', text: 'Abbrechen', onclick: onCancel }),
      ),
    ),
  );
}
