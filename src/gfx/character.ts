import Phaser from 'phaser';
import type { AssetFile, FrameDef } from './assetTypes';
import { BODY_W, findSprite, layerPlan, mirrorX, type Dir } from './layerPlan';
import { getTextureKey } from './textures';
import type { Look } from '../save/profile';

export type FacingDir = Dir | 'left';
export type AnchorName = keyof NonNullable<FrameDef['anchors']>;

/** Layered pixel character; the container origin is the body pivot (feet). */
export class Character extends Phaser.GameObjects.Container {
  private readonly assets: Record<string, AssetFile>;
  private look: Look;
  private readonly slot: number;
  private anim = 'idle';
  private dir: FacingDir = 'down';
  private expression = 'normal';
  private elapsed = 0;
  private lastKey = '';
  private bodyDef: { fps: number; loop: boolean; n: number; anchors: FrameDef['anchors'][] } | null = null;
  /** Anchors of the body frame currently shown (frame coordinates). */
  private curAnchors: FrameDef['anchors'] = undefined;
  private readonly sprites: Phaser.GameObjects.Image[] = [];

  constructor(scene: Phaser.Scene, assets: Record<string, AssetFile>, look: Look, slot: number) {
    super(scene, 0, 0);
    this.assets = assets;
    this.look = look;
    this.slot = slot;
    scene.add.existing(this);
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.tick, this);
    this.once(Phaser.GameObjects.Events.DESTROY, () =>
      scene.events.off(Phaser.Scenes.Events.UPDATE, this.tick, this),
    );
    this.refresh();
  }

  play(anim: string, dir: FacingDir): void {
    if (anim !== this.anim || dir !== this.dir) this.elapsed = 0;
    this.anim = anim;
    this.dir = dir;
    this.bodyDef = null;
    this.refresh();
  }

  /**
   * Anchor (head/hand/back) of the body frame currently shown, relative to the feet (container
   * origin) and mirrored for `left`; null when the frame has none.
   */
  anchor(name: AnchorName): { x: number; y: number } | null {
    const a = this.curAnchors?.[name];
    if (!a) return null;
    const x = a[0] - BODY_W / 2;
    return { x: this.dir === 'left' ? -x : x, y: a[1] - 22 };
  }

  setExpression(e: string): void {
    this.expression = e;
    this.refresh();
  }

  setLook(look: Look): void {
    this.look = look;
    this.bodyDef = null;
    this.lastKey = '';
    this.refresh();
  }

  private tick(_time: number, delta: number): void {
    this.elapsed += delta;
    this.refresh();
  }

  private refresh(): void {
    const left = this.dir === 'left';
    const d: Dir = this.dir === 'left' ? 'side' : this.dir;
    if (!this.bodyDef) {
      const probe = layerPlan(this.look, this.slot, d, this.anim, 0, this.assets);
      const bodyName = probe.find((l) => /^(char\.body|outfit\.)/.test(l.sprite))?.sprite;
      const def = bodyName ? findSprite(this.assets, bodyName)?.def : undefined;
      this.bodyDef = def
        ? { fps: def.fps, loop: def.loop, n: def.frames.length, anchors: def.frames.map((f) => f.anchors) }
        : { fps: 1, loop: false, n: 1, anchors: [] };
    }
    const bd = this.bodyDef;
    const n = Math.floor((this.elapsed / 1000) * bd.fps);
    const frame = bd.loop ? n % bd.n : Math.min(n, bd.n - 1);
    this.curAnchors = bd.anchors[frame];
    // Re-plan only when something visible changed.
    const key = `${this.anim}|${this.dir}|${frame}|${this.expression}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const plan = layerPlan(this.look, this.slot, d, this.anim, frame, this.assets);

    while (this.sprites.length < plan.length) {
      const img = this.scene.add.image(0, 0, '__DEFAULT');
      img.setOrigin(0, 0);
      this.sprites.push(img);
      this.add(img);
    }
    plan.forEach((l, i) => {
      let name = l.sprite;
      if (this.expression !== 'normal' && name.startsWith('char.head.') && name.endsWith('.normal')) {
        const alt = name.replace(/\.normal$/, `.${this.expression}`);
        if (findSprite(this.assets, alt)) name = alt;
      }
      const found = findSprite(this.assets, name);
      const img = this.sprites[i];
      if (!found) {
        img.setVisible(false);
        return;
      }
      const key = getTextureKey(this.scene, found.file, name, l.colors);
      img.setTexture(key, l.frame).setVisible(true);
      img.setFlipX(left);
      // Mirror x around the body frame centre; origin 0,0 so the sprite spans [x, x+w].
      const x = left ? mirrorX(l.x, found.def.w) : l.x;
      img.setPosition(x - BODY_W / 2, l.y - 22);
    });
    for (let i = plan.length; i < this.sprites.length; i++) this.sprites[i].setVisible(false);
  }
}
