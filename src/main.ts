import './ui/ui.css';
import { isMobile, MOBILE_TEXT } from './ui/mobile';

const ui = document.getElementById('ui');
const dev = new URLSearchParams(location.search).get('dev');

if (dev === 'chars') {
  // Dev entry: ?dev=chars shows the character lab (lazy-loaded scene).
  void Promise.all([import('phaser'), import('./game/scenes/CharacterLabScene')]).then(([{ default: Phaser }, { CharacterLabScene }]) => {
    new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'game',
      width: 426,
      height: 240,
      zoom: 3,
      pixelArt: true,
      backgroundColor: '#2b2b3d',
      scene: [CharacterLabScene],
    });
  });
}
else if (ui) {
  if (isMobile(navigator, window.innerWidth)) {
    const note = document.createElement('div');
    note.className = 'cg-mobile';
    note.textContent = MOBILE_TEXT;
    ui.append(note);
  } else {
    void import('./ui/menus').then(({ startMenus }) => startMenus(ui));
  }
}
