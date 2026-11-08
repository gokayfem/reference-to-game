// Keyboard state with blur clearing; overlays can block world movement via `uiBlocking`.
export class Input {
  private held = new Set<string>();
  private pressedQ: string[] = [];
  uiBlocking = false;
  constructor() {
    window.addEventListener('keydown', e => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.pressedQ.push(e.code);
      this.held.add(e.code);
    });
    window.addEventListener('keyup', e => this.held.delete(e.code));
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); });
  }
  clear() { this.held.clear(); }
  down(code: string) { return this.held.has(code); }
  /** Drain one-shot key presses since last frame. */
  drain(): string[] { const q = this.pressedQ; this.pressedQ = []; return q; }
  axis(): [number, number] {
    if (this.uiBlocking) return [0, 0];
    const x = (this.down('KeyD') || this.down('ArrowRight') ? 1 : 0) - (this.down('KeyA') || this.down('ArrowLeft') ? 1 : 0);
    const z = (this.down('KeyS') || this.down('ArrowDown') ? 1 : 0) - (this.down('KeyW') || this.down('ArrowUp') ? 1 : 0);
    return [x, z];
  }
}
