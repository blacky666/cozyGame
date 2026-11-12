/** Input types that take text; sliders, checkboxes and buttons never swallow game keys. */
const TEXT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', '']);

/** True while the user types into a text field: game keys and shortcuts must then do nothing. */
export const isTyping = (t: EventTarget | null): boolean => {
  if (typeof HTMLElement === 'undefined' || !(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t.tagName === 'TEXTAREA') return true;
  return t.tagName === 'INPUT' && TEXT_TYPES.has((t as HTMLInputElement).type);
};
