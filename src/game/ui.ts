import Phaser from 'phaser';
import type { AssetFile, ColorMap } from '../gfx/assetTypes';
import { findSprite } from '../gfx/layerPlan';
import { getTextureKey } from '../gfx/textures';
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

/** Put a sprite's origin on its asset pivot (mirrored when flipped, like Character layers). */
function pivotOrigin(s: Phaser.GameObjects.Sprite, def: { w: number; h: number; pivot: [number, number] }, flip: boolean): void {
  const px = flip ? def.w - def.pivot[0] : def.pivot[0];
  s.setOrigin(px / def.w, def.pivot[1] / def.h);
}

/** assetSprite with the origin on the sprite's pivot, so (x, y) is the pivot point. */
export function pivotSprite(scene: Phaser.Scene, name: string, x: number, y: number): Phaser.GameObjects.Sprite | null {
  const s = assetSprite(scene, name, x, y);
  const def = findSprite(assetsOf(scene), name)?.def;
  if (s && def) pivotOrigin(s, def, false);
  return s;
}

/**
 * Show another asset sprite on an existing sprite (no-op when already shown). The origin moves to
 * the new pivot unless `keepOrigin`; `flip` mirrors it (facing left).
 */
export function swapSprite(scene: Phaser.Scene, s: Phaser.GameObjects.Sprite, name: string, flip = false, keepOrigin = false): void {
  const found = findSprite(assetsOf(scene), name);
  if (!found) return;
  const key = getTextureKey(scene, found.file, name, {});
  if (s.texture.key !== key) {
    s.setTexture(key, 0);
    if (found.def.frames.length > 1) s.play(key);
    else s.stop();
  }
  s.setFlipX(flip);
  if (!keepOrigin) pivotOrigin(s, found.def, flip);
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

export const byKey = <T extends { slot: number }>(players: T[]): Map<PlayerKey, T> =>
  new Map(players.map((p) => ['p' + p.slot, p]));
