import { sound } from './sound';

export const LOBBY_MUSIC = 'ui.musik_lobby_schleife';

/** Buttons with this attribute play their own sound instead of the generic click. */
export const OWN_SOUND = 'data-own-sound';

/** Menu sound "ui.<name>". */
export const uiSound = (name: string): void => sound.play(`ui.${name}`);

/** Soft click on every menu button (DOM), except those that play their own sound. */
export function mountClickSounds(): () => void {
  const onClick = (e: MouseEvent) => {
    const b = (e.target as Element | null)?.closest?.('button');
    if (b && !b.disabled && !b.hasAttribute(OWN_SOUND)) uiSound('klick');
  };
  document.addEventListener('click', onClick, true);
  return () => document.removeEventListener('click', onClick, true);
}

/** Ids that joined / left between two lobby rosters (connected players only). */
export function rosterChange(before: readonly string[], after: readonly string[]): { joined: number; left: number } {
  const b = new Set(before);
  const a = new Set(after);
  return { joined: after.filter((id) => !b.has(id)).length, left: before.filter((id) => !a.has(id)).length };
}
