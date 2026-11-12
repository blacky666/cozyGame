import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { CARD_IDS } from '../flow/cards';
import type { EveningPhase } from '../flow/evening';
import { cardKeyIndex, cardSound, cardsHeader, introCardLine, revealLines } from './cardText';

type CardsPhase = Extract<EveningPhase, { kind: 'cards' }>;
type RevealPhase = Extract<EveningPhase, { kind: 'reveal' }>;

const NAMES: Record<string, string> = { p0: 'Anna', p1: 'Ben', p2: 'Mo' };
const name = (k: string) => NAMES[k] ?? k;
const cards: CardsPhase = { kind: 'cards', round: 1, game: 'schneeball', chooser: 'p2', victim: 'p0', offer: ['falle', 'peinlicher_hut', 'punkte_klau'] };
const reveal = (o: Partial<RevealPhase>): RevealPhase => ({
  kind: 'reveal', round: 1, game: 'schneeball', card: 'falle', chooser: 'p2', victim: 'p0', random: false,
  totals: {}, tieOrder: [], ...o,
});

describe('cardText', () => {
  it('cardsHeader for the chooser, a bystander and the victim', () => {
    expect(cardsHeader(cards, 'p2', name)).toEqual({ header: 'Du bist Letzter – wähle eine Gemeinheit!', sub: 'Opfer: Anna · Taste 1–3 oder klicken' });
    expect(cardsHeader(cards, 'p1', name)).toEqual({ header: 'Mo wählt eine Gemeinheit …', sub: 'Opfer: Anna' });
    expect(cardsHeader(cards, 'p0', name).sub).toBe('Opfer: du');
  });

  it('revealLines per card', () => {
    expect(revealLines(reveal({ card: 'punkte_klau' }), name)).toEqual({ top: 'Mo spielt:', title: 'Punkte-Klau', effect: '1 Punkt: Anna → Mo' });
    expect(revealLines(reveal({ random: true }), name).top).toBe('Zeit um – Zufallskarte!');
    // The chooser left: his name if still known, else a neutral line.
    expect(revealLines(reveal({ random: true, gone: true }), name).top).toBe('Mo ist weg – Zufallskarte!');
    expect(revealLines(reveal({ random: true, gone: true, chooser: 'p5' }), name).top).toBe('Zufallskarte!');
    expect(revealLines(reveal({ random: true, gone: true }), () => '').top).toBe('Zufallskarte!');
    expect(revealLines(reveal({ card: 'falle' }), name).effect).toBe('Anna startet die nächste Runde im Eisblock.');
    expect(revealLines(reveal({ card: 'peinlicher_hut' }), name).effect).toBe('Anna trägt die nächste Runde den Gurken-Hut.');
    expect(revealLines(reveal({ card: 'turbo_start' }), name).effect).toBe('Mo startet die nächste Runde mit einem Extra.');
    expect(revealLines(reveal({ card: 'doppelter_streich' }), name).effect).toBe('Mo darf nächste Runde zweimal streichen.');
    expect(revealLines(reveal({ card: 'rollentausch' }), name).effect).toBe('Mo und Anna tauschen die Startplätze.');
    expect(revealLines(reveal({ card: 'rollentausch', game: 'kartoffel' }), name).effect).toMatch(/Anna startet mit der Kartoffel\.$/);
  });

  it('names fall back to the key', () => {
    expect(revealLines(reveal({ card: 'punkte_klau', victim: 'p9' }), name).effect).toBe('1 Punkt: p9 → Mo');
  });

  it('introCardLine', () => {
    expect(introCardLine({ id: 'falle', chooser: 'p2', victim: 'p0' }, name)).toBe('Gemeinheit von Mo: Falle stellen');
    expect(introCardLine({ id: 'punkte_klau', chooser: 'p2', victim: 'p0' }, name)).toBeNull();
    expect(introCardLine(null, name)).toBeNull();
  });
});

describe('cardSound', () => {
  it('maps every card to a shipped sound', () => {
    expect(cardSound('peinlicher_hut')).toBe('karte.gurkenhut');
    expect(cardSound('falle')).toBe('karte.falle_einfrieren');
    expect(cardSound('punkte_klau')).toBe('karte.punkte_klau');
    expect(existsSync('public/audio/karte/sounds.json')).toBe(true);
    const ids = new Set((JSON.parse(readFileSync('public/audio/karte/sounds.json', 'utf8')) as { toene: { id: string }[] }).toene.map((t) => t.id));
    for (const id of CARD_IDS) expect(ids.has(cardSound(id))).toBe(true);
  });
});

describe('cardKeyIndex', () => {
  it('digit and numpad keys 1–3 pick card 0–2; anything else is null', () => {
    expect(cardKeyIndex('Digit1')).toBe(0);
    expect(cardKeyIndex('Digit3')).toBe(2);
    expect(cardKeyIndex('Numpad2')).toBe(1);
    expect(cardKeyIndex('Digit4')).toBeNull();
    expect(cardKeyIndex('KeyF')).toBeNull();
  });
});
