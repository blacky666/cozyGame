/**
 * Dev page ?dev=text: candidate fonts side by side, each shown the way the game uses text
 * (light text with ink outline on the dark stage, ink text on parchment, regular and bold).
 */

type Candidate = {
  name: string;
  files: Array<{ file: string; weight: string }>;
  /** Weights to show as "normal" and "fett". */
  weights: [number, number];
  note: string;
};

const BASE = `${import.meta.env.BASE_URL}fonts/`;

const FONTS: Candidate[] = [
  { name: 'Pixelify Sans', files: [{ file: 'PixelifySans.ttf', weight: '400 700' }], weights: [400, 700], note: 'aktuell im Spiel' },
  { name: 'Silkscreen', files: [{ file: 'test/Silkscreen-Regular.ttf', weight: '400' }, { file: 'test/Silkscreen-Bold.ttf', weight: '700' }], weights: [400, 700], note: 'nur Großbuchstaben-Stil, sehr klar' },
  { name: 'Press Start 2P', files: [{ file: 'test/PressStart2P.ttf', weight: '400' }], weights: [400, 400], note: 'klassisch Arcade, breit, kein Fettschnitt' },
  { name: 'VT323', files: [{ file: 'test/VT323.ttf', weight: '400' }], weights: [400, 400], note: 'Terminal-Look, schmal, kein Fettschnitt' },
  { name: 'Jersey 10', files: [{ file: 'test/Jersey10.ttf', weight: '400' }], weights: [400, 400], note: 'kräftig, sportlich, kein Fettschnitt' },
  { name: 'Tiny5', files: [{ file: 'test/Tiny5.ttf', weight: '100 900' }], weights: [400, 700], note: 'klein und sauber' },
  { name: 'Micro 5', files: [{ file: 'test/Micro5.ttf', weight: '400' }], weights: [400, 400], note: 'sehr schmal, kein Fettschnitt' },
  { name: 'Handjet', files: [{ file: 'test/Handjet.ttf', weight: '100 900' }], weights: [400, 700], note: 'Pixel-Raster, viele Stärken' },
  { name: 'Bytesized', files: [{ file: 'test/Bytesized.ttf', weight: '400' }], weights: [400, 400], note: 'winzige Pixel-Schrift' },
  { name: 'Fredoka', files: [{ file: 'test/Fredoka.ttf', weight: '300 700' }], weights: [500, 700], note: 'keine Pixel-Schrift: rund, gemütlich, sehr lesbar' },
  { name: 'Nunito', files: [{ file: 'test/Nunito.ttf', weight: '200 1000' }], weights: [600, 800], note: 'keine Pixel-Schrift: weich, sehr lesbar' },
];

const CSS = `
html, body { background: #1c1b29; margin: 0; height: auto !important; overflow: auto !important; }
#game, #ui { display: none !important; }
.fl { max-width: 1240px; margin: 0 auto; padding: 16px; color: #fff; font-family: system-ui, sans-serif; }
.fl h1 { font-size: 22px; margin: 4px 0 4px; }
.fl > p { color: #b9b3d0; margin: 0 0 16px; }
.fl-card { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-bottom: 18px; border: 3px solid #8a5a3a; border-radius: 6px; overflow: hidden; }
.fl-head { grid-column: 1 / -1; background: #3b2418; padding: 8px 14px; font-size: 15px; display: flex; gap: 12px; align-items: baseline; }
.fl-head b { font-size: 20px; color: #ffd27a; }
.fl-head span { color: #d8c7a8; }
.fl-dark { background: #2b2b3d; padding: 14px; }
.fl-light { background: #efdcb0; padding: 14px; color: #3b2418; }
.fl-out { color: #fff; -webkit-text-stroke: 6px #3b2418; paint-order: stroke fill; }
.fl-gold { color: #ffd27a; }
.fl-cream { color: #fff4a8; }
.fl-row { margin: 0 0 8px; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fl-small { font-size: 18px; }
.fl-mid { font-size: 30px; }
.fl-big { font-size: 40px; }
.fl-btn { display: inline-block; background: #b8443a; color: #fff4de; border: 3px solid #3b2418; border-radius: 4px; padding: 6px 14px; font-size: 18px; margin-right: 8px; }
.fl-tag { font: 12px system-ui, sans-serif; color: #8a7a9a; margin: 6px 0 2px; }
.fl-light .fl-tag { color: #8a5a3a; }
@media (max-width: 800px) { .fl-card { grid-template-columns: 1fr; } }
`;

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

function card(f: Candidate, i: number): string {
  const [w, b] = f.weights;
  const st = (weight: number) => `font-family:'${f.name}';font-weight:${weight}`;
  const row = (cls: string, weight: number, text: string) => `<p class="fl-row ${cls}" style="${st(weight)}">${esc(text)}</p>`;
  return `<section class="fl-card">
  <div class="fl-head"><b>${i + 1}. ${esc(f.name)}</b><span>${esc(f.note)}</span></div>
  <div class="fl-dark">
    <div class="fl-tag">im Spiel (dunkler Hintergrund, Kontur), normal</div>
    ${row('fl-mid fl-out fl-gold', w, 'Zwischenstand nach Runde 2')}
    ${row('fl-mid fl-out', w, '0 1 2 3 4 5 6 7 8 9   28 s')}
    ${row('fl-mid fl-out fl-cream', w, 'Chris  Bot Krümel  +5 P.')}
    <div class="fl-tag">fett</div>
    ${row('fl-mid fl-out', b, '2 5 S Z 8 B 0 O 1 l I')}
    ${row('fl-big fl-out fl-gold', b, 'Münzjagd  LOS!')}
  </div>
  <div class="fl-light">
    <div class="fl-tag">Menüs (Pergament), normal</div>
    ${row('fl-mid', w, 'Raumcode MARMELADE-79')}
    ${row('fl-small', w, 'Warte, bis alle bereit sind … Level 12 · 3 Runden')}
    ${row('fl-small', w, 'Sammle so viele Münzen wie möglich! Größe: 0123456789')}
    <div class="fl-tag">fett</div>
    ${row('fl-mid', b, 'KAESE-42  2:25  Ä Ö Ü ß')}
    <p class="fl-row"><span class="fl-btn" style="${st(b)}">Raum erstellen</span><span class="fl-btn" style="${st(b)}">Los geht's!</span></p>
  </div>
</section>`;
}

export async function showFontLab(): Promise<void> {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const root = document.createElement('div');
  root.className = 'fl';
  root.innerHTML = `<h1>Schrift-Test</h1><p>Alle Schriften sind frei (SIL Open Font License). Sag einfach die Nummer, die dir am besten gefällt. Es geht auch eine Mischung, z. B. eine Pixel-Schrift für Titel und eine runde für Zahlen und Texte.</p>${FONTS.map(card).join('')}`;
  document.body.append(root);
  await Promise.all(
    FONTS.flatMap((f) =>
      f.files.map(async ({ file, weight }) => {
        try {
          const face = new FontFace(f.name, `url(${BASE}${file})`, { weight });
          document.fonts.add(await face.load());
        } catch (e) {
          console.error('font failed', f.name, e);
        }
      }),
    ),
  );
}
