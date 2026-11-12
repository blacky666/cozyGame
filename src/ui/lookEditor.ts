import type { AssetFile } from '../gfx/assetTypes';
import { itemSprite, nextReward } from '../progress/items';
import { EMOTE_SLOTS, type Profile } from '../save/profile';
import { drawCharacter, drawSprite } from './charPreview';
import { clear, h } from './dom';
import { applyOption, assignEmote, lookOptions, nextRewardText, TAB_TITLES, TABS, type Option, type Tab } from './lookModel';

export type LookEditorOptions = {
  profile: Profile;
  assets: Record<string, AssetFile> | null;
  /** Player colour slot for the previews (lobby: own slot). */
  slot?: number;
  /** Every change; the caller saves (only the look changes here). */
  onChange(p: Profile): void;
};

/** Icon tabs show the item sprite; look tabs show the character wearing the option. */
const ICON_TAB: Partial<Record<Tab, string>> = { emotes: 'emote', prank: 'prank' };

/**
 * Look editor (spec §7.5): tabs with option tiles, locked tiles greyed with a lock and "ab Level X" /
 * "Überraschungskiste", the four emote slots "Taste 1…4". Returns a cleanup.
 */
export function showLookEditor(host: HTMLElement, o: LookEditorOptions): () => void {
  let profile = o.profile;
  let tab: Tab = 'outfit';
  let emoteSlot: 0 | 1 | 2 | 3 = 0;
  const slot = o.slot ?? 0;
  const el = h('div', { class: 'cg-editor' });
  host.append(el);

  const change = (p: Profile) => {
    profile = p;
    o.onChange(p);
    render();
  };

  const preview = (opt: Option): Node | null => {
    if (!o.assets) return null;
    const icon = ICON_TAB[tab];
    if (icon) return typeof opt.value === 'string' ? drawSprite(itemSprite(`${icon}.${opt.value}`), o.assets, 2) : null;
    const look = applyOption(profile.look, tab as Exclude<Tab, 'emotes'>, opt.value);
    return drawCharacter(look, slot, o.assets);
  };

  const tile = (opt: Option): HTMLElement => {
    const b = h(
      'button',
      {
        class: `cg-tile${opt.selected ? ' selected' : ''}${opt.locked ? ' locked' : ''}`,
        title: opt.lockText ? `${opt.label} – ${opt.lockText}` : opt.label,
        'aria-pressed': opt.selected ? 'true' : 'false',
        disabled: opt.locked,
        onclick: () => pick(opt),
      },
      preview(opt),
      h('span', { class: 'cg-tile-label', text: opt.label }),
      opt.locked && o.assets ? drawSprite('ui.icon.schloss', o.assets, 2) : null,
      opt.lockText ? h('span', { class: 'cg-tile-lock', text: opt.lockText }) : null,
    );
    return b;
  };

  const pick = (opt: Option) => {
    if (opt.locked) return;
    if (tab === 'emotes') {
      if (typeof opt.value !== 'string') return;
      change({ ...profile, look: { ...profile.look, emotes: assignEmote(profile.look.emotes, emoteSlot, opt.value) } });
      return;
    }
    change({ ...profile, look: applyOption(profile.look, tab, opt.value) });
  };

  const emoteSlots = (): HTMLElement =>
    h(
      'div',
      { class: 'cg-emote-slots' },
      ...Array.from({ length: EMOTE_SLOTS }, (_, i) => {
        const id = profile.look.emotes[i] ?? null;
        const n = i as 0 | 1 | 2 | 3;
        return h(
          'div',
          { class: `cg-emote-slot${emoteSlot === i ? ' selected' : ''}` },
          h(
            'button',
            {
              class: 'cg-emote-pick', 'aria-label': `Taste ${i + 1}`,
              onclick: () => {
                emoteSlot = n;
                render();
              },
            },
            h('span', { class: 'cg-tile-label', text: `Taste ${i + 1}` }),
            id && o.assets ? drawSprite(itemSprite(`emote.${id}`), o.assets, 2) : h('span', { class: 'cg-sub', text: '–' }),
          ),
          id
            ? h('button', {
                class: 'cg-emote-clear', text: '×', title: `Taste ${i + 1} leeren`,
                onclick: () => change({ ...profile, look: { ...profile.look, emotes: assignEmote(profile.look.emotes, n, null) } }),
              })
            : null,
        );
      }),
    );

  function render(): void {
    clear(el);
    const tabs = h(
      'div',
      { class: 'cg-tabs', role: 'tablist' },
      ...TABS.map((t) =>
        h('button', {
          class: `cg-tab${t === tab ? ' active' : ''}`, role: 'tab', text: TAB_TITLES[t], 'aria-selected': t === tab ? 'true' : 'false',
          onclick: () => {
            tab = t;
            render();
          },
        }),
      ),
    );
    el.append(tabs);
    if (tab === 'emotes') {
      el.append(emoteSlots(), h('p', { class: 'cg-hint', text: `Taste ${emoteSlot + 1} wählen, dann ein Emote anklicken.` }));
    }
    el.append(h('div', { class: 'cg-tiles' }, ...lookOptions(profile, tab).map(tile)));
  }

  render();
  return () => el.remove();
}

/** "Nächste Belohnung: …" with a preview of the item (or the closed box after the max level). */
export function nextRewardRow(xp: number, assets: Record<string, AssetFile> | null): HTMLElement {
  const r = nextReward(xp);
  const sprite = r.item === 'box' ? 'ui.kiste.zu' : itemSprite(r.item);
  return h(
    'div',
    { class: 'cg-next' },
    assets ? drawSprite(sprite, assets, 2) : null,
    h('span', { class: 'cg-sub', text: nextRewardText(xp) }),
  );
}
