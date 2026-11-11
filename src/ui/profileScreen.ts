import { sound } from '../audio/sound';
import { CONFIG } from '../config';
import { decodeSave, encodeSave, saveFileName } from '../save/saveFile';
import { saveProfile } from '../save/storage';
import type { Profile } from '../save/profile';
import { confirmDialog } from './dialog';
import { clear, h } from './dom';

// Level is a placeholder (1) until Plan 6 provides levelFromXp.
const LEVEL = 1;

export function showProfile(root: HTMLElement, profile: Profile, onBack: (p: Profile) => void): void {
  clear(root);
  let current = profile;
  const msg = h('p', { class: 'cg-error' });
  const stats = h('p', { class: 'cg-hint' });
  const name = h('input', {
    class: 'cg-input', maxlength: CONFIG.players.maxName, value: current.name, 'aria-label': 'Name',
    oninput: () => {
      current = { ...current, name: name.value.trim().slice(0, 16) };
      saveProfile(current);
    },
  });
  const showStats = () => (stats.textContent = `Level ${LEVEL} · ${current.xp} XP`);
  showStats();

  const file = h('input', { type: 'file', accept: '.cozysave', style: 'display:none' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    msg.classList.remove('cg-good');
    const res = await decodeSave(await f.text());
    if (!res.ok) {
      msg.textContent = 'Diese Speicherdatei ist beschädigt oder wurde verändert';
      return;
    }
    msg.textContent = '';
    const ok = await confirmDialog(
      root,
      `Aktuellen Stand Level ${LEVEL} (${current.xp} XP) durch gesicherten Stand Level ${LEVEL} (${res.profile.xp} XP) ersetzen?`,
    );
    if (!ok) return;
    current = res.profile;
    saveProfile(current);
    sound.update(current.settings);
    name.value = current.name;
    showStats();
    msg.textContent = 'Spielstand geladen.';
    msg.classList.add('cg-good');
  });

  const save = async () => {
    sound.play('ablauf.gesichert');
    current = { ...current, settings: sound.settings() };
    saveProfile(current);
    const url = URL.createObjectURL(new Blob([await encodeSave(current)], { type: 'text/plain' }));
    h('a', { href: url, download: saveFileName(current, new Date()) }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  root.append(
    h(
      'div',
      { class: 'cg-screen' },
      h(
        'div',
        { class: 'cg-panel' },
        h('h2', { class: 'cg-h2', text: 'Profil' }),
        h('label', { class: 'cg-label', text: 'Name' }),
        name,
        stats,
        h('button', { class: 'cg-btn', text: 'Spielstand sichern', onclick: () => void save() }),
        h('button', { class: 'cg-btn cg-secondary', text: 'Spielstand laden', onclick: () => file.click() }),
        file,
        msg,
        h('button', { class: 'cg-btn cg-secondary', text: 'Zurück', onclick: () => onBack(current) }),
      ),
    ),
  );
}
