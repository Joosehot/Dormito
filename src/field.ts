// The wind-pressure grid: a damped 2D wave equation. Everything else reads from it.
// x runs across the screen, y runs from the horizon (0) to the nearest row (h - 1).

export class Field {
  readonly w: number;
  readonly h: number;
  cur: Float32Array;
  prev: Float32Array;
  private next: Float32Array;
  private sponge: Float32Array;

  constructor(w = 160, h = 60) {
    this.w = w;
    this.h = h;
    const n = w * h;
    this.cur = new Float32Array(n);
    this.prev = new Float32Array(n);
    this.next = new Float32Array(n);
    // An absorbing rim, so waves leave the field instead of echoing back from its edges.
    this.sponge = new Float32Array(n);
    const edge = 7;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = Math.min(x, y, w - 1 - x, h - 1 - y);
        const k = d >= edge ? 0 : 1 - d / edge;
        this.sponge[y * w + x] = 1 - 0.06 * k * k;
      }
    }
  }

  /** One step of next = 2·cur − prev + c²·∇²cur, damped. Stable for c² ≤ 0.5. The rim stays 0. */
  step(c2: number, damping: number): void {
    const { w, h, cur, prev, next, sponge } = this;
    for (let y = 1; y < h - 1; y++) {
      let i = y * w + 1;
      for (let x = 1; x < w - 1; x++, i++) {
        const lap = cur[i - 1] + cur[i + 1] + cur[i - w] + cur[i + w] - 4 * cur[i];
        next[i] = (2 * cur[i] - prev[i] + c2 * lap) * damping * sponge[i];
      }
    }
    this.prev = cur;
    this.cur = next;
    this.next = prev;
  }

  /** A round push of energy at (gx, gy). */
  inject(gx: number, gy: number, amount: number, radius: number): void {
    const { w, h, cur } = this;
    const span = Math.ceil(radius * 2.2);
    const inv = 1 / (2 * radius * radius);
    const x0 = Math.max(1, Math.floor(gx) - span), x1 = Math.min(w - 2, Math.ceil(gx) + span);
    const y0 = Math.max(1, Math.floor(gy) - span), y1 = Math.min(h - 2, Math.ceil(gy) + span);
    for (let y = y0; y <= y1; y++) {
      const dy = y - gy;
      for (let x = x0; x <= x1; x++) {
        const dx = x - gx;
        cur[y * w + x] += amount * Math.exp(-(dx * dx + dy * dy) * inv);
      }
    }
  }

  /** A push along one row only (a wind front is one such push on every row). */
  injectRow(gx: number, y: number, amount: number, radius: number): void {
    const { w, cur } = this;
    if (y < 1 || y > this.h - 2) return;
    const span = Math.ceil(radius * 2.2);
    const inv = 1 / (2 * radius * radius);
    const x0 = Math.max(1, Math.floor(gx) - span), x1 = Math.min(w - 2, Math.ceil(gx) + span);
    for (let x = x0; x <= x1; x++) {
      const dx = x - gx;
      cur[y * w + x] += amount * Math.exp(-dx * dx * inv);
    }
  }

  sample(gx: number, gy: number): number {
    const { w, h, cur } = this;
    const x = Math.min(w - 1.001, Math.max(0, gx));
    const y = Math.min(h - 1.001, Math.max(0, gy));
    const xi = x | 0, yi = y | 0;
    const fx = x - xi, fy = y - yi;
    const i = yi * w + xi;
    const a = cur[i] + (cur[i + 1] - cur[i]) * fx;
    const b = cur[i + w] + (cur[i + w + 1] - cur[i + w]) * fx;
    return a + (b - a) * fy;
  }

  /** Mean energy per cell: displacement plus motion. */
  energy(): number {
    const { cur, prev } = this;
    let e = 0;
    for (let i = 0; i < cur.length; i++) {
      const v = cur[i] - prev[i];
      e += cur[i] * cur[i] + 40 * v * v;
    }
    return e / cur.length;
  }

  clear(): void {
    this.cur.fill(0);
    this.prev.fill(0);
    this.next.fill(0);
  }
}

/**
 * A hand moving from (x0, y0) to (x1, y1) in grid cells over `seconds`: energy along the path,
 * more the faster it moves, pushing the wheat the way the hand goes.
 */
export function brush(field: Field, x0: number, y0: number, x1: number, y1: number, seconds: number, strength: number): void {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) return;
  const speed = Math.max(1, len / Math.max(seconds, 1 / 240)); // cells per second
  // The field a stroke should raise grows gently with speed. A hand slower than the waves hands its
  // energy to a wave that carries it off (the field grows with speed); a faster one lays it down as
  // a line before it can spread (the field grows with what is laid per cell). Hence the divisor.
  const want = 1.1 * Math.pow(speed / 12, 0.08);
  const density = (strength * want) / Math.min(0.4 * speed, 30);
  const sign = Math.abs(dx) > 0.25 * len ? Math.sign(dx) : 1;
  const steps = Math.ceil(len / 0.6);
  for (let k = 1; k <= steps; k++) {
    const s = k / steps;
    field.inject(x0 + dx * s, y0 + dy * s, sign * density * (len / steps), 2.2);
  }
}
