type Child = Node | string | null | undefined | false;
type Props = {
  class?: string;
  text?: string;
  onclick?: (e: MouseEvent) => void;
  oninput?: (e: Event) => void;
  [attr: string]: string | boolean | number | ((e: never) => void) | undefined;
};

/** Tiny hyperscript helper: h('div', {class: 'x'}, child, 'text'). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

export function clear(el: HTMLElement): void {
  el.replaceChildren();
}
