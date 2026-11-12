import { CONFIG } from '../config';

/*
 * Gemeinheit-Karten (spec §6): catalog, copy and the offer drawn for the overall last place.
 * Ids equal the asset names (card.bild.<id>); the order matters for the shuffle.
 */

export const CARD_IDS = ['falle', 'peinlicher_hut', 'punkte_klau', 'turbo_start', 'doppelter_streich', 'rollentausch'] as const;
export type CardId = (typeof CARD_IDS)[number];
/** The card picked after a round; acts in the next round. */
export type RoundCard = { id: CardId; chooser: string; victim: string };

const TITLES: Record<CardId, string> = {
  falle: 'Falle stellen',
  peinlicher_hut: 'Peinlicher Hut',
  punkte_klau: 'Punkte-Klau',
  turbo_start: 'Turbo-Start',
  doppelter_streich: 'Doppelter Streich',
  rollentausch: 'Rollentausch',
};

const TURBO_TEXT: Record<string, string> = {
  schneeball: 'Du startest mit vollen Schneebällen und einem Riesenschneeball.',
  farbkrieg: 'Du startest mit einer Farbbombe.',
  kartoffel: 'Du sprintest am Anfang ohne Abklingzeit.',
  wackelturm: 'Du startest mit einer Ärger-Ladung.',
};

export const isCardId = (x: unknown): x is CardId => typeof x === 'string' && (CARD_IDS as readonly string[]).includes(x);

export const cardTitle = (id: CardId): string => TITLES[id];

/** Card text as the chooser reads it; some cards depend on the next game. */
export function cardText(id: CardId, nextGame: string): string {
  switch (id) {
    case 'falle':
      return 'Der Erste startet 3 s eingefroren im Eisblock.';
    case 'peinlicher_hut':
      return 'Der Erste trägt eine Runde lang einen riesigen Gurken-Hut.';
    case 'punkte_klau':
      return '1 Punkt wandert sofort vom Ersten zu dir.';
    case 'turbo_start':
      return TURBO_TEXT[nextGame] ?? 'Du startest mit einem Extra.';
    case 'doppelter_streich':
      return 'Du darfst deinen Streich nächste Runde zweimal einsetzen.';
    case 'rollentausch':
      return nextGame === 'kartoffel'
        ? 'Du tauschst mit dem Ersten die Startplätze, und er startet mit der Kartoffel.'
        : 'Du tauschst mit dem Ersten die Startplätze.';
  }
}

/** Cards that can act in the next game: Wackel-Turm plots are identical, so Rollentausch would do nothing. */
export const eligibleCards = (nextGame: string): CardId[] =>
  CARD_IDS.filter((id) => !(id === 'rollentausch' && nextGame === 'wackelturm'));

/** The chooser's offer: first CONFIG.gemeinheit.offer cards of a shuffle; an eligible `force` (dev) comes first. */
export function offerCards(nextGame: string, rand: () => number, force?: CardId): CardId[] {
  const deck = eligibleCards(nextGame);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const n = CONFIG.gemeinheit.offer;
  if (force && deck.includes(force)) return [force, ...deck.filter((id) => id !== force).slice(0, n - 1)];
  return deck.slice(0, n);
}
