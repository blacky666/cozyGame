import { cardTitle, type CardId, type RoundCard } from '../flow/cards';
import type { EveningPhase } from '../flow/evening';

/*
 * Player-facing copy of the card scene and the round intro (pure, unit-tested).
 * `name` maps a player key to the display name; unknown keys show the key itself.
 */

type CardsPhase = Extract<EveningPhase, { kind: 'cards' }>;
type RevealPhase = Extract<EveningPhase, { kind: 'reveal' }>;
type NameOf = (k: string) => string;

const nameOr = (name: NameOf, k: string): string => name(k) || k;

/** Header and sub line while the chooser picks; the chooser and the victim read about themselves. */
export function cardsHeader(phase: CardsPhase, self: string, name: NameOf): { header: string; sub: string } {
  const victim = phase.victim === self ? 'du' : nameOr(name, phase.victim);
  if (phase.chooser === self) {
    return { header: 'Du bist Letzter – wähle eine Gemeinheit!', sub: `Opfer: ${victim} · Taste 1–3 oder klicken` };
  }
  return { header: `${nameOr(name, phase.chooser)} wählt eine Gemeinheit …`, sub: `Opfer: ${victim}` };
}

/** The three lines of the reveal: who played it (or the timeout), the card title, what it does. */
export function revealLines(phase: RevealPhase, name: NameOf): { top: string; title: string; effect: string } {
  const c = nameOr(name, phase.chooser);
  const v = nameOr(name, phase.victim);
  const top = phase.random ? 'Zeit um – Zufallskarte!' : `${c} spielt:`;
  let effect: string;
  switch (phase.card) {
    case 'falle':
      effect = `${v} startet die nächste Runde im Eisblock.`;
      break;
    case 'peinlicher_hut':
      effect = `${v} trägt die nächste Runde den Gurken-Hut.`;
      break;
    case 'punkte_klau':
      effect = `1 Punkt: ${v} → ${c}`;
      break;
    case 'turbo_start':
      effect = `${c} startet die nächste Runde mit einem Extra.`;
      break;
    case 'doppelter_streich':
      effect = `${c} darf nächste Runde zweimal streichen.`;
      break;
    case 'rollentausch':
      effect = `${c} und ${v} tauschen die Startplätze.` + (phase.game === 'kartoffel' ? ` ${v} startet mit der Kartoffel.` : '');
      break;
  }
  return { top, title: cardTitle(phase.card), effect };
}

/** Round intro line for the card acting in this round; none for Punkte-Klau (already applied). */
export function introCardLine(card: RoundCard | null, name: NameOf): string | null {
  if (!card || card.id === 'punkte_klau') return null;
  return `Gemeinheit von ${nameOr(name, card.chooser)}: ${cardTitle(card.id)}`;
}

/** Sound of a card (package karte): Peinlicher Hut and Falle have their own names. */
export const cardSound = (id: CardId): string =>
  id === 'peinlicher_hut' ? 'karte.gurkenhut' : id === 'falle' ? 'karte.falle_einfrieren' : `karte.${id}`;
