import { InputState } from '../game/boat';

/** Keyboard state; held keys are cleared on blur/visibility loss so nothing sticks after alt-tab. */
export class Input {
  private down = new Set<string>();
  private pressed: string[] = [];
  /** synthetic overrides (touch buttons / automated playtests drive the same path as keys) */
  virtual = new Set<string>();
  constructor() {
    window.addEventListener('keydown', e => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.push(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', e => this.down.delete(e.code));
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); });
  }
  clear() { this.down.clear(); this.virtual.clear(); }
  has(...codes: string[]) { return codes.some(c => this.down.has(c) || this.virtual.has(c)); }
  takePressed(): string[] { const p = this.pressed; this.pressed = []; return p; }
  state(): InputState {
    return {
      throttle: this.has('KeyW', 'ArrowUp'),
      brake: this.has('KeyS', 'ArrowDown'),
      left: this.has('KeyA', 'ArrowLeft'),
      right: this.has('KeyD', 'ArrowRight'),
      boost: this.has('ShiftLeft', 'ShiftRight'),
    };
  }
}
