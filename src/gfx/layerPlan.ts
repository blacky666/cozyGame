import type { AssetFile, ColorMap, SpriteDef } from './assetTypes';
import type { Look } from '../save/profile';

export type Dir = 'down' | 'up' | 'side';
export type LayerSpec = {
  sprite: string;
  frame: number;
  x: number;
  y: number;
  colors: ColorMap;
  flipX: boolean;
};

/** Body pivot x in the 24-wide body frame; used to mirror `left`. */
export const BODY_W = 24;

const SYMBOLS = ['kreis', 'dreieck', 'quadrat', 'stern'];
/** Animations that only exist for one direction. */
const DOWN_ONLY = new Set(['fall', 'ko', 'cheer', 'cry', 'laugh', 'wave', 'dance', 'point']);
const SIDE_ONLY = /^build_/;

/** Find the asset file that defines a sprite. */
export function findSprite(
  assets: Record<string, AssetFile>,
  name: string,
): { file: AssetFile; def: SpriteDef } | null {
  for (const file of Object.values(assets)) {
    const def = file.sprites[name];
    if (def) return { file, def };
  }
  return null;
}

/**
 * Pure compositing plan (no Phaser). Layer order: shadow, back, body, head,
 * hair, glasses, hat, symbol. Sprites missing from the assets are skipped.
 */
export function layerPlan(
  look: Look,
  slot: number,
  dir: Dir,
  anim: string,
  frameIndex: number,
  assets: Record<string, AssetFile>,
): LayerSpec[] {
  // Single-direction animations ignore the requested direction.
  const d: Dir = DOWN_ONLY.has(anim) ? 'down' : SIDE_ONLY.test(anim) ? 'side' : dir;

  const head = assets['char-head'];
  const misc = assets['char-misc'];
  const skin = head?.ramps?.skin?.[look.skin];
  const hairR = head?.ramps?.hair?.[look.hairColor];
  const player = misc?.ramps?.player?.[slot];

  const playerColors: ColorMap = player ? { player: player.c, player_dark: player.C } : {};
  const skinColors: ColorMap = skin ? { skin: skin.s, skin_dark: skin.S } : {};
  const hairColors: ColorMap = hairR
    ? { hair: hairR.h, hair_dark: hairR.H, hair_light: hairR.g }
    : {};

  const layers: LayerSpec[] = [];
  const push = (sprite: string, frame: number, x: number, y: number, colors: ColorMap): void => {
    layers.push({ sprite, frame, x, y, colors, flipX: false });
  };
  const exists = (n: string): boolean => findSprite(assets, n) !== null;

  // shadow, centred on its pivot at the body pivot (12, 22)
  const sh = findSprite(assets, 'char.shadow');
  if (sh) push('char.shadow', 0, 12 - sh.def.pivot[0], 22 - sh.def.pivot[1], {});

  const bodyName =
    look.outfit === 'tunika' ? `char.body.${d}.${anim}` : `outfit.${look.outfit}.${d}.${anim}`;
  const body = findSprite(assets, bodyName);
  if (!body) return layers;
  const bf = frameIndex % body.def.frames.length;
  const fr = body.def.frames[bf];
  const anchors = fr.anchors;

  // back item (before body)
  if (look.back && anchors) {
    const n = `back.${look.back}`;
    const s = findSprite(assets, n);
    if (s) push(n, 0, anchors.back[0] - s.def.pivot[0], anchors.back[1] - s.def.pivot[1], playerColors);
  }

  push(bodyName, bf, 0, 0, { ...playerColors, ...skinColors });

  if (anchors) {
    const [ax, ay] = anchors.head;
    let headName = `char.head.${d}.normal`;
    let hairName = `char.hair.${look.hair}.${d}`;
    let hf = 0;
    if (fr.head_pose) {
      // head_pose looks like "fall.2" / "fall_laugh.2": sprite suffix + frame index
      const m = /^(.+)\.(\d+)$/.exec(fr.head_pose);
      if (m) {
        headName = `char.head.${m[1]}`;
        hf = Number(m[2]);
      }
      hairName = `char.hair.${look.hair}.fall`;
    }
    const at = (n: string, frame: number, colors: ColorMap): void => {
      const s = findSprite(assets, n);
      if (s) push(n, frame, ax - s.def.pivot[0], ay - s.def.pivot[1], colors);
    };
    at(headName, hf, skinColors);
    at(hairName, hf, { ...hairColors, ...skinColors });
    if (look.glasses) {
      const n = [`glasses.${look.glasses}.${d}`, `glasses.${look.glasses}`].find(exists);
      if (n) at(n, 0, {});
    }
    if (look.hat) {
      const n = [`hat.${look.hat}.${d}`, `hat.${look.hat}`].find(exists);
      if (n) at(n, 0, playerColors);
    }
    // player symbol floats above the head
    const symName = `ui.symbol.${SYMBOLS[slot]}`;
    const sym = findSprite(assets, symName);
    if (sym) push(symName, 0, ax - sym.def.pivot[0], ay - 14 - sym.def.h, playerColors);
  }
  return layers;
}
