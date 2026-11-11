import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseManifest } from './manifest';

describe('parseManifest', () => {
  it('reads single files, variant lists, kinds, loops and volumes', () => {
    const defs = parseManifest({
      paket: 'x',
      toene: [
        { id: 'x.a', datei: 'audio/x/a.mp3', art: 'effekt', schleife: false, lautstaerke: 0.5 },
        { id: 'x.b', datei: ['audio/x/b_1.mp3', 'audio/x/b_2.mp3'], art: 'musik', schleife: true, lautstaerke: 2 },
      ],
    });
    expect(defs).toEqual([
      { id: 'x.a', files: ['audio/x/a.mp3'], kind: 'effekt', loop: false, volume: 0.5 },
      { id: 'x.b', files: ['audio/x/b_1.mp3', 'audio/x/b_2.mp3'], kind: 'musik', loop: true, volume: 1 },
    ]);
  });

  it('skips broken entries, unsafe paths and duplicates but keeps the rest', () => {
    const warnings: string[] = [];
    const defs = parseManifest(
      {
        toene: [
          { id: 'x.ok', datei: 'audio/x/ok.mp3' },
          { id: 'noprefix', datei: 'audio/x/a.mp3' },
          { id: 'x.evil', datei: 'https://evil.example/a.mp3' },
          { id: 'x.up', datei: 'audio/../secret.mp3' },
          { id: 'x.ok', datei: 'audio/x/ok2.mp3' },
          null,
        ],
      },
      (m) => warnings.push(m),
    );
    expect(defs.map((d) => d.id)).toEqual(['x.ok']);
    expect(defs[0]).toMatchObject({ kind: 'effekt', loop: false, volume: 1 });
    expect(warnings.length).toBe(5);
  });

  it('returns nothing for a non-manifest', () => {
    expect(parseManifest(null)).toEqual([]);
    expect(parseManifest({ toene: 'x' })).toEqual([]);
  });

  it('accepts the shipped schneeball package completely', () => {
    const raw = JSON.parse(readFileSync('public/audio/schneeball/sounds.json', 'utf-8'));
    const warnings: string[] = [];
    const defs = parseManifest(raw, (m) => warnings.push(m));
    expect(warnings).toEqual([]);
    expect(defs.length).toBe(30);
    for (const d of defs) for (const f of d.files) expect(() => readFileSync(`public/${f}`)).not.toThrow();
  });
});
