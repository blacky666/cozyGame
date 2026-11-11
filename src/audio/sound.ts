import { parseManifest, type SoundDef } from './manifest';
import { busGain, loadSound, saveSound, type SoundSettings } from './settings';

export type PlayOpts = {
  /** Extra volume factor 0..1 (e.g. quieter for other players). */
  volume?: number;
  /** Stereo position -1 (left) .. 1 (right). */
  pan?: number;
  /** Start later (ms), e.g. a jingle after a whistle. */
  delayMs?: number;
};

/** The same sound starts at most once per this gap (several events in one frame stay one sound). */
const MIN_GAP_MS = 35;
const MUSIC_FADE_S = 0.6;
const BUS_FADE_S = 0.05;

/** Index of the next variant: random, but never the same file twice in a row (when there are several). */
export function pickVariant(count: number, last: number, rand: () => number): number {
  if (count <= 1) return 0;
  if (last < 0 || last >= count) return Math.min(count - 1, Math.floor(rand() * count));
  const i = Math.min(count - 2, Math.floor(rand() * (count - 1)));
  return i >= last ? i + 1 : i;
}

type Music = { id: string; src: AudioBufferSourceNode; gain: GainNode };
/** Decoded music tracks kept in memory (current + previous; ~20 MB per minute each). */
const MUSIC_CACHE = 2;

/**
 * Web Audio sound manager: packages from public/audio/<paket>/sounds.json, a music bus and an
 * effects bus (jingles count as effects) under the user's sliders. Browsers start audio only after
 * a user gesture: until then plays are dropped (stale sounds would pile up), music is remembered
 * and starts on unlock. Missing sounds are silent, never an error.
 */
class SoundManager {
  private ctx: AudioContext | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private readonly defs = new Map<string, SoundDef>();
  private readonly buffers = new Map<string, AudioBuffer>();
  /** Music files as downloaded (MP3, small); decoded only when played. */
  private readonly compressed = new Map<string, ArrayBuffer>();
  /** Decoded music, oldest first (Map keeps insertion order). */
  private readonly musicCache = new Map<string, AudioBuffer>();
  private startingMusic: string | null = null;
  private readonly packages = new Map<string, Promise<void>>();
  private readonly lastAt = new Map<string, number>();
  private readonly lastVariant = new Map<string, number>();
  private readonly loops = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();
  private readonly listeners = new Set<(s: SoundSettings) => void>();
  private music: Music | null = null;
  private wantMusic: string | null = null;
  private cached: SoundSettings | null = null;
  /** Read on first use (not at import: tests and the dev pages never touch storage). */
  private get s(): SoundSettings {
    return (this.cached ??= loadSound());
  }
  private set s(v: SoundSettings) {
    this.cached = v;
  }

  /** Create the context (suspended until a gesture) and resume it on the first click/key. */
  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicBus.connect(ctx.destination);
    this.sfxBus.connect(ctx.destination);
    this.applyBuses(0);
    const unlock = () => {
      void ctx.resume().then(() => {
        if (ctx.state !== 'running') return;
        for (const ev of ['pointerdown', 'keydown']) window.removeEventListener(ev, unlock, true);
        if (this.wantMusic && !this.music) this.startMusic(this.wantMusic);
      });
    };
    for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, unlock, true);
    return ctx;
  }

  private running(): AudioContext | null {
    const ctx = this.context();
    return ctx && ctx.state === 'running' ? ctx : null;
  }

  private applyBuses(fadeS = BUS_FADE_S): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus || !this.sfxBus) return;
    const t = ctx.currentTime;
    this.musicBus.gain.setTargetAtTime(busGain(this.s, 'music'), t, fadeS || 0.001);
    this.sfxBus.gain.setTargetAtTime(busGain(this.s, 'sfx'), t, fadeS || 0.001);
  }

  /** Load a package's manifest and decode its files (once; later calls share the promise). */
  loadPackage(name: string): Promise<void> {
    let p = this.packages.get(name);
    if (p) return p;
    p = (async () => {
      const ctx = this.context();
      if (!ctx) return;
      const base = import.meta.env.BASE_URL;
      try {
        const res = await fetch(`${base}audio/${name}/sounds.json`);
        if (!res.ok) return;
        const defs = parseManifest(await res.json(), (m) => console.warn(`cozygame audio: ${m}`));
        for (const d of defs) this.defs.set(d.id, d);
        // Music stays compressed until played (decoded it takes ~20 MB per minute). It is played
        // through Web Audio all the same: only a decoded buffer loops without a gap at the seam.
        const musicFiles = new Set(defs.filter((d) => d.kind === 'musik').flatMap((d) => d.files));
        const files = [...new Set(defs.flatMap((d) => d.files))];
        await Promise.all(
          files.map(async (f) => {
            try {
              const r = await fetch(`${base}${f}`);
              if (!r.ok) return;
              const data = await r.arrayBuffer();
              if (musicFiles.has(f)) this.compressed.set(f, data);
              else this.buffers.set(f, await ctx.decodeAudioData(data));
            } catch (e) {
              console.warn(`cozygame audio: ${f} unavailable`, e);
            }
          }),
        );
        // Music asked for before its files were there.
        if (this.wantMusic && !this.music && this.defs.has(this.wantMusic)) this.startMusic(this.wantMusic);
      } catch (e) {
        console.warn(`cozygame audio: package ${name} unavailable`, e);
      }
    })();
    this.packages.set(name, p);
    return p;
  }

  has(id: string): boolean {
    const d = this.defs.get(id);
    return !!d && d.files.some((f) => this.buffers.has(f) || this.compressed.has(f));
  }

  private source(ctx: AudioContext, d: SoundDef): AudioBufferSourceNode | null {
    const loaded = d.files.filter((f) => this.buffers.has(f));
    if (loaded.length === 0) return null;
    const i = pickVariant(loaded.length, this.lastVariant.get(d.id) ?? -1, Math.random);
    this.lastVariant.set(d.id, i);
    const src = ctx.createBufferSource();
    src.buffer = this.buffers.get(loaded[i])!;
    return src;
  }

  /** One-shot effect or jingle. Unknown or not yet loaded ids are ignored. */
  play(id: string, o: PlayOpts = {}): void {
    const ctx = this.running();
    const d = this.defs.get(id);
    if (!ctx || !d || !this.sfxBus) return;
    const now = performance.now() + (o.delayMs ?? 0);
    if (now - (this.lastAt.get(id) ?? -Infinity) < MIN_GAP_MS) return;
    const src = this.source(ctx, d);
    if (!src) return;
    this.lastAt.set(id, now);
    const gain = ctx.createGain();
    gain.gain.value = d.volume * Math.min(1, Math.max(0, o.volume ?? 1));
    let node: AudioNode = src.connect(gain);
    if (o.pan && ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, o.pan));
      node = node.connect(pan);
    }
    node.connect(d.kind === 'musik' ? this.musicBus! : this.sfxBus);
    src.start(ctx.currentTime + Math.max(0, o.delayMs ?? 0) / 1000);
  }

  /** First of the ids that is loaded (a game's own sound, then the shared fallback). */
  playFirst(ids: string[], o?: PlayOpts): void {
    const id = ids.find((x) => this.has(x));
    if (id) this.play(id, o);
  }

  /** A round sound: the game's own ("<pkg>.<name>") or else the shared one ("ablauf.<name>"). */
  playRound(pkg: string | undefined, name: string, o?: PlayOpts): void {
    this.playFirst([...(pkg ? [`${pkg}.${name}`] : []), `ablauf.${name}`], o);
  }

  /** Start or stop a looping effect (one instance per id). */
  loop(id: string, on: boolean): void {
    const cur = this.loops.get(id);
    if (!on) {
      if (cur) {
        this.loops.delete(id);
        try { cur.src.stop(); } catch { /* already stopped */ }
      }
      return;
    }
    if (cur) return;
    const ctx = this.running();
    const d = this.defs.get(id);
    if (!ctx || !d || !this.sfxBus) return;
    const src = this.source(ctx, d);
    if (!src) return;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = d.volume;
    src.connect(gain).connect(this.sfxBus);
    src.start();
    this.loops.set(id, { src, gain });
  }

  stopLoops(): void {
    for (const id of [...this.loops.keys()]) this.loop(id, false);
  }

  /** Switch the background music (crossfade); null fades it out. Same id again keeps it running. */
  setMusic(id: string | null): void {
    this.wantMusic = id;
    if (this.music?.id === id) return;
    this.fadeOutMusic();
    if (id) this.startMusic(id);
  }

  private fadeOutMusic(): void {
    const m = this.music;
    this.music = null;
    if (!m || !this.ctx) return;
    const t = this.ctx.currentTime;
    m.gain.gain.cancelScheduledValues(t);
    m.gain.gain.setValueAtTime(m.gain.gain.value, t);
    m.gain.gain.linearRampToValueAtTime(0, t + MUSIC_FADE_S);
    try { m.src.stop(t + MUSIC_FADE_S + 0.05); } catch { /* already stopped */ }
  }

  /** Decoded track (from the cache, else decoded now; the cache keeps MUSIC_CACHE tracks). */
  private async musicBuffer(ctx: AudioContext, file: string): Promise<AudioBuffer | null> {
    const hit = this.musicCache.get(file);
    if (hit) {
      this.musicCache.delete(file);
      this.musicCache.set(file, hit);
      return hit;
    }
    const data = this.compressed.get(file);
    if (!data) return null;
    // decodeAudioData detaches its input: decode a copy, the compressed file stays for later.
    const buf = await ctx.decodeAudioData(data.slice(0));
    this.musicCache.set(file, buf);
    while (this.musicCache.size > MUSIC_CACHE) this.musicCache.delete(this.musicCache.keys().next().value!);
    return buf;
  }

  private startMusic(id: string): void {
    const ctx = this.running();
    const d = this.defs.get(id);
    if (!ctx || !d || !this.musicBus || this.startingMusic === id) return;
    this.startingMusic = id;
    void this.musicBuffer(ctx, d.files[0])
      .then((buf) => {
        // Switched again (or already playing) while decoding.
        if (!buf || this.wantMusic !== id || this.music?.id === id) return;
        this.playMusic(ctx, id, d.volume, buf);
      })
      .catch((e) => console.warn(`cozygame audio: music ${id} unavailable`, e))
      .finally(() => {
        if (this.startingMusic === id) this.startingMusic = null;
      });
  }

  private playMusic(ctx: AudioContext, id: string, volume: number, buf: AudioBuffer): void {
    this.fadeOutMusic();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + MUSIC_FADE_S);
    src.connect(gain).connect(this.musicBus!);
    src.start();
    this.music = { id, src, gain };
  }

  settings(): SoundSettings {
    return { ...this.s };
  }

  update(patch: Partial<SoundSettings>): void {
    this.s = { ...this.s, ...patch };
    saveSound(this.s);
    this.context();
    this.applyBuses();
    for (const l of this.listeners) l(this.settings());
  }

  toggleMute(): void {
    this.update({ muted: !this.s.muted });
  }

  onChange(l: (s: SoundSettings) => void): () => void {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }
}

/** The app-wide sound manager. */
export const sound = new SoundManager();
