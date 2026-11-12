/** Small achievements ("Erfolge"), at most once per player per round; XP in CONFIG.progress.featXp. */
export const FEAT_IDS = [
  'schubser',
  'schnee_serie',
  'schnee_erster',
  'schnee_schneemann',
  'kartoffel_knapp',
  'kartoffel_pass',
  'farb_tuencher',
  'farb_flaeche',
  'turm_zehn',
  'turm_aerger',
  'turm_ziel',
  'streich_gelandet',
] as const;

export type FeatId = (typeof FEAT_IDS)[number];

const LABELS: Record<FeatId, string> = {
  schubser: '3 Schubser gelandet',
  schnee_serie: '3 Treffer in Folge',
  schnee_erster: 'Erster Treffer der Runde',
  schnee_schneemann: 'Schneemann umgehauen',
  kartoffel_knapp: 'In letzter Sekunde weitergegeben',
  kartoffel_pass: 'Kartoffel 3× weitergegeben',
  farb_tuencher: '3 Gegner getüncht',
  farb_flaeche: 'Ein Drittel der Fläche',
  turm_zehn: 'Turm aus 10 Klötzen',
  turm_aerger: 'Ärger-Aktion gelandet',
  turm_ziel: 'Zielhöhe erreicht',
  streich_gelandet: 'Streich gelandet',
};

const KNOWN: ReadonlySet<string> = new Set(FEAT_IDS);

export function isFeatId(x: unknown): x is FeatId {
  return typeof x === 'string' && KNOWN.has(x);
}

export function featLabel(id: FeatId): string {
  return LABELS[id];
}
