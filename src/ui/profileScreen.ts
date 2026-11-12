import { sound } from '../audio/sound';
import { CONFIG } from '../config';
import type { AssetFile } from '../gfx/assetTypes';
import { levelInfo } from '../progress/levels';
import { decodeSave, encodeSave, saveFileName } from '../save/saveFile';
import { saveProfile } from '../save/storage';
import type { Profile } from '../save/profile';
import { drawCharacter } from './charPreview';
import { confirmDialog } from './dialog';
import { clear, h } from './dom';
import { nextRewardRow, showLookEditor } from './lookEditor';

/** "Level N · X XP" plus "· ★ k" once surprise boxes were earned. */
export function levelLine(xp: number): string {
  const i = levelInfo(xp);
  return `Level ${i.level} · ${xp} XP${i.boxes > 0 ? ` · ★ ${i.boxes}` : ''}`;
}

/** "noch Y XP bis Level N+1", after the max level until the next surprise box. */
function toNext(xp: number): string {
  const i = levelInfo(xp);
  const left = i.need - i.into;
  return i.level >= CONFIG.progress.maxLevel ? `noch ${left} XP bis zur nächsten Überraschungskiste` : `noch ${left} XP bis Level ${i.level + 1}`;
}

export function showProfile(
  root: HTMLElement,
  profile: Profile,
  assets: Record<string, AssetFile> | null,
  onBack: (p: Profile) => void,
  notice?: string,
): void {
  clear(root);
  let current = profile;
  const msg = h('p', { class: 'cg-error' });
  if (notice) {
    msg.textContent = notice;
    msg.classList.add('cg-good');
  }
  const name = h('input', {
    class: 'cg-input', maxlength: CONFIG.players.maxName, value: current.name, 'aria-label': 'Name',
    oninput: () => {
      current = { ...current, name: name.value.trim().slice(0, 16) };
      saveProfile(current);
    },
  });
  const info = levelInfo(current.xp);
  const bar = h('div', { class: 'cg-xpbar' }, h('div', { class: 'cg-xpbar-fill', style: `width:${Math.round((100 * info.into) / info.need)}%` }));
  const charBox = h('div', { class: 'cg-profile-char' });
  const showChar = () => {
    clear(charBox);
    if (assets) charBox.append(drawCharacter(current.look, 0, assets));
  };
  showChar();

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
      `Aktuellen Stand Level ${levelInfo(current.xp).level} durch gesicherten Stand Level ${levelInfo(res.profile.xp).level} ersetzen?`,
    );
    if (!ok) return;
    saveProfile(res.profile);
    sound.update(res.profile.settings);
    // Rebuild everything (level, bar, editor) from the loaded profile.
    showProfile(root, res.profile, assets, onBack, 'Spielstand geladen.');
  });

  const save = async () => {
    sound.play('ablauf.gesichert');
    current = { ...current, settings: sound.settings() };
    saveProfile(current);
    const url = URL.createObjectURL(new Blob([await encodeSave(current)], { type: 'text/plain' }));
    h('a', { href: url, download: saveFileName(current, new Date()) }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const editorHost = h('div');
  root.append(
    h(
      'div',
      { class: 'cg-screen' },
      h(
        'div',
        { class: 'cg-panel cg-profile' },
        h('h2', { class: 'cg-h2', text: 'Profil' }),
        h('label', { class: 'cg-label', text: 'Name' }),
        name,
        h(
          'div',
          { class: 'cg-row cg-profile-top' },
          charBox,
          h(
            'div',
            { class: 'cg-profile-stats' },
            h('p', { class: 'cg-level', text: levelLine(current.xp) }),
            bar,
            h('p', { class: 'cg-sub', text: toNext(current.xp) }),
            nextRewardRow(current.xp, assets),
          ),
        ),
        editorHost,
        h(
          'div',
          { class: 'cg-row' },
          h('button', { class: 'cg-btn', text: 'Spielstand sichern', onclick: () => void save() }),
          h('button', { class: 'cg-btn cg-secondary', text: 'Spielstand laden', onclick: () => file.click() }),
        ),
        file,
        msg,
        h('button', { class: 'cg-btn cg-secondary', text: 'Zurück', onclick: () => onBack(current) }),
      ),
    ),
  );
  showLookEditor(editorHost, {
    profile: current,
    assets,
    onChange: (p) => {
      current = { ...current, look: p.look };
      saveProfile(current);
      showChar();
    },
  });
}
