import { CONFIG } from '../config';
import { featLabel, isFeatId, type FeatId } from './feats';

const P = CONFIG.progress;

/** One XP source of one player. `tag` (day bonus) is only ever added client-side. */
export type XpLine =
  | { kind: 'teilnahme'; xp: number }
  | { kind: 'platz'; round: number; place: number; xp: number } // place 1-based
  | { kind: 'gesamt'; place: 1 | 2; xp: number }
  | { kind: 'erfolg'; round: number; feat: FeatId; xp: number }
  | { kind: 'tag'; xp: number };

/** What the host remembers of one finished round. */
export type RoundRecord = { placements: string[][]; feats: Record<string, string[]> };

/** Start index of each player's tie group (as roundPoints counts places). */
function startIndex(groups: string[][]): Map<string, number> {
  const out = new Map<string, number>();
  let place = 0;
  for (const g of groups) {
    for (const k of g) if (!out.has(k)) out.set(k, place);
    place += g.length;
  }
  return out;
}

/**
 * XP lines of every player for the rounds played so far; `final` (overall tie groups) adds the gesamt
 * lines. Nothing at all until a round finished. Unknown feats and repeats within a round are dropped.
 */
export function eveningXp(players: string[], rounds: RoundRecord[], final: string[][] | null): Record<string, XpLine[]> {
  const out: Record<string, XpLine[]> = {};
  for (const k of players) out[k] = [];
  if (rounds.length === 0) return out;
  for (const k of players) out[k].push({ kind: 'teilnahme', xp: P.participationXp });
  rounds.forEach((r, i) => {
    const round = i + 1;
    const idx = startIndex(r.placements);
    for (const k of players) {
      const at = idx.get(k);
      if (at !== undefined) out[k].push({ kind: 'platz', round, place: at + 1, xp: P.placeXp[at] ?? 0 });
      const got = new Set<FeatId>();
      for (const f of r.feats[k] ?? []) {
        if (!isFeatId(f) || got.has(f)) continue;
        got.add(f);
        out[k].push({ kind: 'erfolg', round, feat: f, xp: P.featXp[f] ?? 0 });
      }
    }
  });
  if (final) {
    const idx = startIndex(final);
    for (const k of players) {
      const at = idx.get(k);
      if (at === 0 || at === 1) out[k].push({ kind: 'gesamt', place: at === 0 ? 1 : 2, xp: P.finalXp[at] ?? 0 });
    }
  }
  return out;
}

/** Podium rows: Teilnahme, Rundenplätze, each feat (grouped), overall place, day bonus; zero rows omitted. */
export function podiumItems(lines: XpLine[]): { label: string; xp: number }[] {
  let teilnahme = 0;
  let platz = 0;
  let sieg = 0;
  let zweiter = 0;
  let tag = 0;
  const feats = new Map<FeatId, { n: number; xp: number }>();
  for (const l of lines) {
    if (l.kind === 'teilnahme') teilnahme += l.xp;
    else if (l.kind === 'platz') platz += l.xp;
    else if (l.kind === 'gesamt') {
      if (l.place === 1) sieg += l.xp;
      else zweiter += l.xp;
    } else if (l.kind === 'tag') tag += l.xp;
    else {
      const f = feats.get(l.feat) ?? { n: 0, xp: 0 };
      feats.set(l.feat, { n: f.n + 1, xp: f.xp + l.xp });
    }
  }
  const rows: { label: string; xp: number }[] = [
    { label: 'Teilnahme', xp: teilnahme },
    { label: 'Rundenplätze', xp: platz },
    ...[...feats].map(([id, f]) => ({ label: f.n > 1 ? `${featLabel(id)} ×${f.n}` : featLabel(id), xp: f.xp })),
    { label: 'Gesamtsieg', xp: sieg },
    { label: 'Platz 2 gesamt', xp: zweiter },
    { label: 'Erster Abend heute', xp: tag },
  ];
  return rows.filter((r) => r.xp > 0);
}
