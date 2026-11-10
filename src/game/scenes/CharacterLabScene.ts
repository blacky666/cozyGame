import Phaser from 'phaser';
import type { AssetFile } from '../../gfx/assetTypes';
import { Character, type FacingDir } from '../../gfx/character';
import { loadAssets } from '../../gfx/textures';
import { defaultProfile } from '../../save/profile';

const DIRS: FacingDir[] = ['down', 'up', 'side', 'left'];

/** Dev-only scene (?dev=chars): 4 slots x every body animation. Left/right = anim, up/down = direction. */
export class CharacterLabScene extends Phaser.Scene {
  private chars: Character[] = [];
  private anims_: string[] = [];
  private ai = 0;
  private di = 0;
  private label!: Phaser.GameObjects.Text;

  constructor() {
    super('CharacterLabScene');
  }

  create(): void {
    this.label = this.add.text(4, 4, 'loading...', { fontSize: '10px', color: '#fff' });
    void loadAssets().then((assets) => this.build(assets));
  }

  private build(assets: Record<string, AssetFile>): void {
    const names = new Set<string>();
    for (const n of Object.keys(assets['char-body'].sprites)) names.add(n.split('.').slice(3).join('.'));
    this.anims_ = [...names];
    const hairs = ['kurz', 'wuschel', 'zopf', 'kurz'];
    this.chars = [0, 1, 2, 3].map((slot) => {
      const look = { ...defaultProfile().look, hat: null, hair: hairs[slot], hairColor: slot, skin: slot };
      const c = new Character(this, assets, look, slot);
      c.setPosition(71 + slot * 95, 140);
      return c;
    });
    const kb = this.input.keyboard;
    kb?.on('keydown-RIGHT', () => this.step(1, 0));
    kb?.on('keydown-LEFT', () => this.step(-1, 0));
    kb?.on('keydown-UP', () => this.step(0, 1));
    kb?.on('keydown-DOWN', () => this.step(0, -1));
    this.apply();
  }

  private step(a: number, d: number): void {
    this.ai = (this.ai + a + this.anims_.length) % this.anims_.length;
    this.di = (this.di + d + DIRS.length) % DIRS.length;
    this.apply();
  }

  private apply(): void {
    const anim = this.anims_[this.ai];
    this.chars.forEach((c) => c.play(anim, DIRS[this.di]));
    this.label.setText(`${anim} / ${DIRS[this.di]}  (left/right: anim, up/down: dir)`);
  }
}
