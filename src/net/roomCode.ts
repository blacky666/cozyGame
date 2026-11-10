// Cozy ASCII German words (umlauts transliterated), 3-12 letters.
export const ROOM_WORDS: readonly string[] = [
  'KAESE', 'KARTOFFEL', 'SCHNEE', 'PINSEL', 'KUERBIS', 'KAMIN', 'DECKE', 'KAKAO',
  'TEEKANNE', 'KERZE', 'LATERNE', 'WOLLSOCKE', 'APFEL', 'BIRNE', 'HONIG', 'BRETZEL',
  'KEKS', 'PLAETZCHEN', 'MARMELADE', 'SOFA', 'KISSEN', 'PANTOFFEL', 'MUETZE', 'SCHAL',
  'HANDSCHUH', 'SCHLITTEN', 'IGLU', 'LAGERFEUER', 'PILZ', 'IGEL', 'HASE',
  'KATZE', 'WALD', 'WIESE', 'BAECKEREI', 'BROT', 'SEMMEL', 'WAFFEL', 'PUDDING',
  'ZIMT', 'MANDEL', 'NUSS', 'TANNE', 'STERN', 'MONDSCHEIN', 'REGEN', 'GARTEN',
];

export function generateRoomCode(rand: () => number = Math.random): string {
  const word = ROOM_WORDS[Math.min(ROOM_WORDS.length - 1, Math.floor(rand() * ROOM_WORDS.length))];
  const num = 10 + Math.min(89, Math.floor(rand() * 90));
  return `${word}-${num}`;
}

export function normalizeRoomCode(input: string): string | null {
  const s = input
    .normalize('NFC')
    .trim()
    .toUpperCase()
    .replace(/Ä/g, 'AE')
    .replace(/Ö/g, 'OE')
    .replace(/Ü/g, 'UE')
    .replace(/[–—]/g, '-')
    .replace(/[\s_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^([A-Z]{3,12})(\d{2})$/, '$1-$2');
  return /^[A-Z]{3,12}-\d{2}$/.test(s) ? s : null;
}
