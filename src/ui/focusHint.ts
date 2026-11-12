/**
 * Banner while the page has no keyboard focus (a click into the address bar or onto another screen):
 * keys then never reach the game, which feels like a frozen character. A click into the page fixes it.
 */
export function mountFocusHint(): () => void {
  const el = document.createElement('div');
  el.className = 'cg-focus-hint';
  el.setAttribute('role', 'status');
  el.textContent = 'Tastatur nicht im Spiel: kurz ins Spiel klicken';
  el.hidden = true;
  document.body.append(el);
  const show = () => (el.hidden = false);
  const hide = () => (el.hidden = true);
  window.addEventListener('blur', show);
  window.addEventListener('focus', hide);
  return () => {
    window.removeEventListener('blur', show);
    window.removeEventListener('focus', hide);
    el.remove();
  };
}
