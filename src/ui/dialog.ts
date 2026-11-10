import { h } from './dom';

/** Modal confirm dialog; resolves true on confirm. */
export function confirmDialog(root: HTMLElement, text: string, ok = 'Ersetzen', cancel = 'Abbrechen'): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (v: boolean) => {
      overlay.remove();
      resolve(v);
    };
    const overlay = h(
      'div',
      { class: 'cg-overlay', role: 'dialog' },
      h(
        'div',
        { class: 'cg-panel cg-dialog' },
        h('p', { text }),
        h(
          'div',
          { class: 'cg-row' },
          h('button', { class: 'cg-btn cg-secondary', text: cancel, onclick: () => done(false) }),
          h('button', { class: 'cg-btn', text: ok, onclick: () => done(true) }),
        ),
      ),
    );
    root.append(overlay);
  });
}
