import { describe, expect, it } from 'vitest';
import { floodFill, hitboxOverhang, loadArenaCases, pinchGaps, unreachableRegions } from '../../../tools/arenaPassability';

// Figures collide only with the feet circle (bodyRadius); hats and bodies never collide. So what
// matters is: where the art shows a gap the feet fit through, the hitboxes must let them through
// (with 2 px to spare), and gaps that look closed must not be enterable.
describe('arena passability', () => {
  for (const c of loadArenaCases()) {
    describe(c.name, () => {
      const field = floodFill(c.arena, c.spawns, c.r, 1);

      it('every spawn point is a free feet position', () => {
        for (const [x, y] of c.spawns) expect(field.free[Math.round(y) * field.cols + Math.round(x)]).toBe(1);
      });

      it('no tight gaps (2r .. 2r+2 px) and no gaps that look open but block the feet', () => {
        const bad = pinchGaps(c, 2, field).filter((g) => g.problem);
        expect(bad.map((g) => `${g.problem} ${g.gap}px (art ${g.artGap}px) at ${g.x},${g.y}: ${g.a} <-> ${g.b}`)).toEqual([]);
      });

      it('every visible walkable spot is reachable from the spawns', () => {
        const lost = unreachableRegions(c, field).filter((r) => !r.hidden);
        expect(lost).toEqual([]);
      });

      it('no hitbox edge lies outside the drawn sprite', () => {
        const over: string[] = [];
        for (const s of new Set(c.arena.solids.map((x) => x.sprite))) {
          const o = hitboxOverhang(c.file, s);
          if (o && (o.top || o.bottom || o.left || o.right)) over.push(`${s} ${JSON.stringify(o)}`);
        }
        expect(over).toEqual([]);
      });
    });
  }
});
