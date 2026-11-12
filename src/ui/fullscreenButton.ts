/** 9x9 pixel corner brackets: pointing outwards to enter fullscreen, inwards to leave it. */
const ENTER = ['0,0,3,1', '0,0,1,3', '6,0,3,1', '8,0,1,3', '0,8,3,1', '0,6,1,3', '6,8,3,1', '8,6,1,3'];
const LEAVE = ['0,2,3,1', '2,0,1,3', '6,2,3,1', '6,0,1,3', '0,6,3,1', '2,6,1,3', '6,6,3,1', '6,6,1,3'];

function icon(full: boolean): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 9 9');
  svg.setAttribute('width', '27');
  svg.setAttribute('height', '27');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  for (const r of full ? LEAVE : ENTER) {
    const [x, y, w, hh] = r.split(',');
    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', w);
    rect.setAttribute('height', hh);
    svg.append(rect);
  }
  return svg;
}

const toggle = (): void => {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  else void document.documentElement.requestFullscreen?.().catch(() => {});
};

/**
 * Fullscreen button left of the speaker in the bottom right corner (outside #ui, like the speaker).
 * No hotkey: F is the prank key (spec §5); Esc leaves fullscreen natively. Not shown where the browser
 * has no Fullscreen API (iPhone).
 */
export function mountFullscreenButton(): () => void {
  if (!document.fullscreenEnabled) return () => {};
  const btn = h();
  btn.addEventListener('click', () => {
    toggle();
    // Never keep focus: a later Space (shove/drop) must not press this button again.
    btn.blur();
  });
  document.body.append(btn);
  const show = () => {
    const full = !!document.fullscreenElement;
    btn.replaceChildren(icon(full));
    btn.title = full ? 'Vollbild beenden' : 'Vollbild';
    btn.setAttribute('aria-label', btn.title);
  };
  show();
  document.addEventListener('fullscreenchange', show);
  return () => {
    document.removeEventListener('fullscreenchange', show);
    btn.remove();
  };
}

function h(): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'cg-sound-btn cg-fullscreen-btn';
  return b;
}
