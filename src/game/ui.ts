import Phaser from 'phaser';
import type { AssetFile, ColorMap } from '../gfx/assetTypes';
import { findSprite } from '../gfx/layerPlan';
import { getTextureKey } from '../gfx/textures';
import type { PlayerInfo } from '../net/roster';
import type { PlayerKey } from '../minigames/types';
import { zoomOf } from './zoom';

/** Tiny5 letters + Silkscreen digits, declared in index.html. */
export const FONT = '"GameFont", monospace';
export const INK = '#3b2418';

/** Smallest font size (virtual px) that stays legible at x3 zoom. */
export const MIN_FONT = 10;

/**
 * Pixel-font text, centred by default. Rendered at the screen's real resolution so glyphs stay
 * sharp under zoom. Light text gets a thin ink outline (a thick one fills the letters in);
 * ink-coloured text (on parchment) gets none unless asked.
 */
export function txt(
  scene: Phaser.Scene,
  x: number,
  y: number,
  s: string,
  size = 10,
  color = '#ffffff',
  outline = color.toLowerCase() !== INK,
): Phaser.GameObjects.Text {
  const px = Math.max(MIN_FONT, size);
  return scene.add
    .text(x, y, s, {
      fontFamily: FONT,
      fontSize: `${px}px`,
      color,
      stroke: INK,
      strokeThickness: outline ? (px >= 18 ? 2 : 1) : 0,
      align: 'center',
      resolution: zoomOf(scene),
    })
    .setOrigin(0.5);
}

export const assetsOf = (scene: Phaser.Scene): Record<string, AssetFile> =>
  scene.registry.get('assets') as Record<string, AssetFile>;

/** Sprite from the asset JSONs (plays its animation when it has several frames). */
export function assetSprite(
  scene: Phaser.Scene,
  name: string,
  x: number,
  y: number,
  colors: ColorMap = {},
): Phaser.GameObjects.Sprite | null {
  const found = findSprite(assetsOf(scene), name);
  if (!found) return null;
  const key = getTextureKey(scene, found.file, name, colors);
  const s = scene.add.sprite(x, y, key, 0);
  if (found.def.frames.length > 1) s.play(key);
  return s;
}

/** Symbol (kreis/dreieck/quadrat/stern) in the player's colour. */
export function playerSymbol(scene: Phaser.Scene, slot: number, x: number, y: number): Phaser.GameObjects.Sprite | null {
  const ramp = assetsOf(scene)['char-misc']?.ramps?.player?.[slot];
  if (!ramp) return null;
  return assetSprite(scene, `ui.symbol.${ramp.symbol}`, x, y, { player: ramp.c, player_dark: ramp.C });
}

export function playerColor(scene: Phaser.Scene, slot: number): string {
  return assetsOf(scene)['char-misc']?.ramps?.player?.[slot]?.c ?? '#ffffff';
}

/** Simple clickable button (wood look, like the DOM menus). */
export function button(scene: Phaser.Scene, x: number, y: number, label: string, onClick: () => void): Phaser.GameObjects.Container {
  const t = txt(scene, 0, 0, label, 12, '#fff4de');
  const w = Math.ceil(t.width) + 16;
  const bg = scene.add.rectangle(0, 0, w, 20, 0xb8443a).setStrokeStyle(2, 0x3b2418);
  const c = scene.add.container(x, y, [bg, t]);
  bg.setInteractive({ useHandCursor: true })
    .on('pointerover', () => bg.setFillStyle(0xc9564a))
    .on('pointerout', () => bg.setFillStyle(0xb8443a))
    .on('pointerdown', onClick);
  return c;
}

export const byKey = (players: PlayerInfo[]): Map<PlayerKey, PlayerInfo> =>
  new Map(players.map((p) => ['p' + p.slot, p]));
