import { APP_VERSION, CONFIG } from './config';

const ui = document.getElementById('ui');
if (ui) {
  ui.textContent = `cozyGame v${APP_VERSION} (${CONFIG.players.min}-${CONFIG.players.max} players)`;
}
