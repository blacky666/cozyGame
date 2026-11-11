import { h } from '../ui/dom';
import { sound } from './sound';
import type { SoundSettings } from './settings';

export const MUTE_KEY = 'KeyM';

/** 11x9 pixel speaker; waves when sound is on, a cross when muted. */
const SPEAKER = ['0,3,2,3', '2,2,1,5', '3,1,1,7', '4,0,1,9'];
const WAVES = ['6,3,1,3', '8,1,1,2', '9,3,1,3', '8,6,1,2'];
const CROSS = ['6,2,1,1', '7,3,1,1', '8,4,1,1', '9,5,1,1', '10,6,1,1', '10,2,1,1', '9,3,1,1', '7,5,1,1', '6,6,1,1'];

function icon(muted: boolean): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 11 9');
  svg.setAttribute('width', '33');
  svg.setAttribute('height', '27');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  for (const r of [...SPEAKER, ...(muted ? CROSS : WAVES)]) {
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

/** Typing into a text field must never toggle mute. */
const typing = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

const slider = (label: string, value: number, on: (v: number) => void) => {
  const input = h('input', {
    type: 'range', min: 0, max: 100, step: 5, value: Math.round(value * 100), class: 'cg-slider', 'aria-label': label,
  });
  input.addEventListener('input', () => on(Number(input.value) / 100));
  return { row: h('label', { class: 'cg-sound-row' }, h('span', { text: label }), input), input };
};

/**
 * Speaker button in the bottom right corner (the top right holds a game HUD score), outside #ui so menu screens (which clear #ui) and the
 * running game keep it. Click opens the sliders; M toggles mute anywhere except in text fields.
 */
export function mountSoundButton(): () => void {
  const s = sound.settings();
  const music = slider('Musik', s.music, (v) => sound.update({ music: v }));
  const sfx = slider('Effekte', s.sfx, (v) => sound.update({ sfx: v }));
  const mute = h('button', { class: 'cg-btn cg-secondary cg-sound-mute' });
  mute.addEventListener('click', () => sound.toggleMute());
  const panel = h('div', { class: 'cg-sound-panel', hidden: true }, music.row, sfx.row, mute);
  const btn = h('button', { class: 'cg-sound-btn', 'aria-haspopup': 'true' });
  btn.addEventListener('click', () => (panel.hidden = !panel.hidden));
  const box = h('div', { class: 'cg-sound' }, btn, panel);
  document.body.append(box);

  const show = (st: SoundSettings) => {
    btn.replaceChildren(icon(st.muted));
    btn.classList.toggle('muted', st.muted);
    btn.title = st.muted ? 'Ton aus (M)' : 'Ton an (M)';
    btn.setAttribute('aria-label', btn.title);
    mute.textContent = st.muted ? 'Ton an (M)' : 'Stumm (M)';
    music.input.value = String(Math.round(st.music * 100));
    sfx.input.value = String(Math.round(st.sfx * 100));
  };
  show(s);
  const off = sound.onChange(show);

  const onKey = (e: KeyboardEvent) => {
    if (e.code !== MUTE_KEY || e.repeat || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
    sound.toggleMute();
  };
  const onOutside = (e: PointerEvent) => {
    if (!panel.hidden && !box.contains(e.target as Node)) panel.hidden = true;
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('pointerdown', onOutside, true);
  return () => {
    off();
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('pointerdown', onOutside, true);
    box.remove();
  };
}
