export type RecolorSlot =
  | 'player'
  | 'player_dark'
  | 'skin'
  | 'skin_dark'
  | 'hair'
  | 'hair_light'
  | 'hair_dark';

export type ColorMap = Partial<Record<RecolorSlot, string>>;

export type FrameDef = {
  rows: string[];
  anchors?: { head: [number, number]; hand: [number, number]; back: [number, number] };
  head_pose?: string;
};

export type SpriteDef = {
  w: number;
  h: number;
  pivot: [number, number];
  fps: number;
  loop: boolean;
  hitbox?: [number, number, number, number];
  slice?: [number, number, number, number];
  frames: FrameDef[];
};

export type Ramps = {
  skin?: { s: string; S: string }[];
  hair?: { name: string; h: string; H: string; g: string }[];
  player?: { player: number | string; symbol: string; c: string; C: string }[];
};

export type MapDef = {
  w: number;
  h: number;
  tile: number;
  raster: string[];
  layers: { boden: string[][]; flaechen: (string | null)[][]; rand: (string | null)[][] };
  objects: { sprite: string; x: number; y: number }[];
  hinweis?: string;
};

export type AssetFile = {
  maps?: Record<string, MapDef>;
  palette: Record<string, string>;
  recolor: Record<string, RecolorSlot>;
  ramps?: Ramps;
  sprites: Record<string, SpriteDef>;
};
