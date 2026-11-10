import { APP_VERSION, CONFIG } from './config';

const ui = document.getElementById('ui');
if (ui) {
  ui.textContent = `cozyGame v${APP_VERSION} (${CONFIG.players.min}-${CONFIG.players.max} players)`;
}

// Dev entry: ?dev=chars shows the character lab (lazy-loaded scene).
if (new URLSearchParams(location.search).get('dev') === 'chars') {
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
