// Keyboard/mouse input with pointer lock; drag-to-look fallback when lock is refused.
export class Input {
  held = new Set<string>();
  private pressed = new Set<string>();
  mouseDown = false;
  yaw = 0; pitch = -0.08;
  sens = 0.0022;
  lookDX = 0; lookDY = 0;
  locked = false;
  dragLook = false;
  enabled = false;
  onLockChange: (locked: boolean) => void = () => {};
  onLockError: () => void = () => {};
  private lastX: number | null = null; private lastY = 0;

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.held.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); });
    el.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.mouseDown = true; this.lastX = e.clientX; this.lastY = e.clientY; }
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) { this.mouseDown = false; this.lastX = null; } });
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      let dx = 0, dy = 0;
      if (this.locked) { dx = e.movementX; dy = e.movementY; }
      else if (this.dragLook && this.lastX !== null) { dx = e.clientX - this.lastX; dy = e.clientY - this.lastY; this.lastX = e.clientX; this.lastY = e.clientY; }
      else return;
      if (Math.abs(dx) > 400 || Math.abs(dy) > 400) return; // ignore browser lock-jump spikes
      this.look(dx, dy);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) { this.mouseDown = false; this.held.clear(); }
      this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => { this.dragLook = true; this.onLockError(); });
  }

  look(dx: number, dy: number) {
    this.yaw -= dx * this.sens;
    this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch - dy * this.sens));
    this.lookDX += dx; this.lookDY += dy;
  }

  requestLock() {
    try {
      const r = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === 'function') r.catch(() => { this.dragLook = true; this.onLockError(); });
    } catch { this.dragLook = true; this.onLockError(); }
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  /** Edge-triggered key press, consumed once. */
  take(code: string) { const h = this.pressed.has(code); this.pressed.delete(code); return h; }
  peekPressed(code: string) { return this.pressed.has(code); }
  clearPressed() { this.pressed.clear(); }
  clear() { this.held.clear(); this.pressed.clear(); this.mouseDown = false; this.lastX = null; }
  axis(neg: string, pos: string) { return (this.held.has(pos) ? 1 : 0) - (this.held.has(neg) ? 1 : 0); }
}
