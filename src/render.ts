// Canvas 2D: sunset sky, the low sun, the field drawn back to front in depth slices (one path per
// slice and light, so thousands of stalks cost a few dozen strokes), glints, the hand's trail, motes.

import { Stalks } from "./stalks.ts";
import { mulberry32, subSeed } from "./rng.ts";

export const SUN_X = 0.72;
const SLICES = 30;
const LIGHTS = 3; // full rim light, some, none
const TRAIL_LIFE = 2.6;

type RGB = [number, number, number];
const HAZE: RGB = [228, 164, 142];
const STEM_NEAR: RGB = [128, 78, 34];
const HEAD_NEAR: RGB = [214, 156, 70];
const RIM: RGB = [255, 222, 160];

const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const css = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

export interface TrailPoint {
  x: number;
  y: number;
  time: number;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  W = 0;
  H = 0;
  dpr = 1;
  private bg: HTMLCanvasElement = document.createElement("canvas");
  private glow: HTMLCanvasElement = makeGlow();
  private buckets: Int32Array[] = [];
  private stalks: Stalks | null = null;
  maxDpr: number;

  constructor(canvas: HTMLCanvasElement, maxDpr: number) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d", { alpha: false })!;
    this.maxDpr = maxDpr;
    this.resize();
  }

  // The patch: a diamond centred at (cx, cy), half as tall (B) as it is wide (A).
  cx = 0;
  cy = 0;
  A = 0;
  B = 0;

  resize(): void {
    this.dpr = Math.min(this.maxDpr, window.devicePixelRatio || 1);
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.A = Math.min(this.W * 0.42, this.H * 0.66);
    this.B = this.A * (this.W < this.H ? 0.6 : 0.5);
    this.cx = this.W / 2;
    this.cy = this.H * 0.56;
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.paintBackground();
  }

  /** The scale strokes are sized by. */
  get size(): number {
    return this.A * 1.3;
  }

  // Where a stalk at x (left corner 0, right corner 1) and depth t (top corner 0, bottom 1) stands,
  // and how tall it is (for height factor 1).
  baseX(x: number): number {
    return this.cx + (2 * x - 1) * this.A;
  }
  baseY(t: number): number {
    return this.cy + (2 * t - 1) * this.B;
  }
  stalkH(t: number): number {
    return this.B * 0.34 * (0.88 + 0.24 * t);
  }

  /** Screen point to the patch (u, v), 0..1 inside: the hand moves through the heads, 3/4 up the stalks. */
  toField(sx: number, sy: number): { u: number; v: number } {
    const a = (sx - this.cx) / this.A; // u − v
    const b = (sy + 0.75 * this.stalkH(0.5) - (this.cy - this.B)) / this.B; // u + v
    return { u: (a + b) / 2, v: (b - a) / 2 };
  }

  /** The patch outline, a little uneven like ploughed ground, corners top, right, bottom, left. */
  private outline(dy = 0): [number, number][] {
    const corners: [number, number][] = [
      [this.cx, this.cy - this.B],
      [this.cx + this.A, this.cy],
      [this.cx, this.cy + this.B],
      [this.cx - this.A, this.cy],
    ];
    const pts: [number, number][] = [];
    for (let e = 0; e < 4; e++) {
      const [x0, y0] = corners[e], [x1, y1] = corners[(e + 1) % 4];
      const nx = y1 - y0, ny = x0 - x1, len = Math.hypot(nx, ny);
      for (let k = 0; k < 24; k++) {
        const s = k / 24;
        const wob = Math.sin(s * Math.PI) * (Math.sin(s * 9 + e * 2.1) * 0.6 + Math.sin(s * 23 + e) * 0.4) * this.B * 0.035;
        pts.push([x0 + (x1 - x0) * s + (nx / len) * wob, y0 + (y1 - y0) * s + (ny / len) * wob + dy]);
      }
    }
    return pts;
  }

  setStalks(s: Stalks): void {
    this.stalks = s;
    const lists: number[][] = Array.from({ length: SLICES * LIGHTS }, () => []);
    for (let i = 0; i < s.n; i++) {
      const slice = Math.min(SLICES - 1, Math.floor(s.t[i] * SLICES));
      const d = Math.abs(this.baseX(s.x[i]) / this.W - SUN_X);
      const light = d < 0.1 ? 0 : d < 0.26 ? 1 : 2;
      lists[slice * LIGHTS + light].push(i);
    }
    this.buckets = lists.map((l) => Int32Array.from(l));
  }

  private paintBackground(): void {
    const { W, H, dpr } = this;
    const c = this.bg;
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Sky all round: dusk above, the glow at the sun's height, dusk again below the patch.
    const sunY = H * 0.36;
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#241a42");
    sky.addColorStop(0.16, "#563063");
    sky.addColorStop(0.28, "#a8506a");
    sky.addColorStop(0.4, "#f2a062");
    sky.addColorStop(0.47, "#f6b877");
    sky.addColorStop(0.62, "#c06a62");
    sky.addColorStop(0.82, "#6a3a5a");
    sky.addColorStop(1, "#2e1d3c");
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);

    const sx = W * SUN_X, sy = sunY, r = H * 0.075;
    const halo = g.createRadialGradient(sx, sy, r * 0.5, sx, sy, H * 0.7);
    halo.addColorStop(0, "rgba(255,214,140,0.55)");
    halo.addColorStop(0.25, "rgba(255,170,110,0.22)");
    halo.addColorStop(1, "rgba(255,150,110,0)");
    g.fillStyle = halo;
    g.fillRect(0, 0, W, H);
    const disc = g.createRadialGradient(sx, sy, 0, sx, sy, r);
    disc.addColorStop(0, "rgba(255,250,228,1)");
    disc.addColorStop(0.7, "rgba(255,226,160,0.95)");
    disc.addColorStop(1, "rgba(255,200,130,0)");
    g.fillStyle = disc;
    g.beginPath();
    g.arc(sx, sy, r, 0, Math.PI * 2);
    g.fill();

    // The patch: a slab of earth (its side first), then the ground it grows from.
    const depth = this.B * 0.13;
    const trace = (pts: [number, number][]) => {
      g.beginPath();
      pts.forEach(([px, py], k) => (k ? g.lineTo(px, py) : g.moveTo(px, py)));
      g.closePath();
    };
    const top = this.outline();
    const low = this.outline(depth);
    // The side: the lower half of the rim (right corner, bottom, left corner) and its copy below.
    const q = top.length / 4;
    const front = top.slice(q, 3 * q + 1);
    const side = [...front, ...low.slice(q, 3 * q + 1).reverse()];
    trace(side);
    const sideFill = g.createLinearGradient(0, this.cy, 0, this.cy + this.B + depth);
    sideFill.addColorStop(0, "#4a2a1c");
    sideFill.addColorStop(1, "#22130f");
    g.fillStyle = sideFill;
    g.fill();
    trace(top);
    const earth = g.createLinearGradient(0, this.cy - this.B, 0, this.cy + this.B);
    earth.addColorStop(0, "#b77a48");
    earth.addColorStop(0.5, "#8a5228");
    earth.addColorStop(1, "#5e3418");
    g.fillStyle = earth;
    g.fill();
    // Back-light along the far edges, toward the sun.
    g.strokeStyle = "rgba(255,214,150,0.35)";
    g.lineWidth = 1.5;
    g.beginPath();
    [...top.slice(3 * q), ...top.slice(0, q + 1)].forEach(([px, py], k) => (k ? g.lineTo(px, py) : g.moveTo(px, py)));
    g.stroke();
  }

  draw(trail: TrailPoint[], motes: Motes, now: number, hint: number): void {
    const { g, W, H, dpr } = this;
    const s = this.stalks!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.drawImage(this.bg, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.lineCap = "round";

    const sizeK = this.size / 900;
    const { x, t, height, ang, rank } = s;
    const frac = s.activeFrac;
    for (let slice = 0; slice < SLICES; slice++) {
      const tm = (slice + 0.5) / SLICES;
      const near = smooth(0.55 + 0.45 * tm);
      const stemBase = mix(HAZE, STEM_NEAR, near);
      const headBase = mix(HAZE, HEAD_NEAR, Math.min(1, near * 1.2));
      const stemW = (0.7 + 0.9 * tm) * sizeK;
      const headW = stemW * 1.75 + 0.4;
      for (let light = 0; light < LIGHTS; light++) {
        const list = this.buckets[slice * LIGHTS + light];
        if (!list.length) continue;
        const rim = light === 0 ? 0.42 : light === 1 ? 0.2 : 0;
        // Stems.
        g.beginPath();
        for (let k = 0; k < list.length; k++) {
          const i = list[k];
          if (rank[i] >= frac) continue;
          const bx = this.baseX(x[i]), by = this.baseY(t[i]), h = this.stalkH(t[i]) * height[i];
          const a = ang[i];
          g.moveTo(bx, by);
          g.quadraticCurveTo(bx + Math.sin(a * 0.5) * h * 0.55, by - Math.cos(a * 0.5) * h * 0.55, bx + Math.sin(a) * h, by - Math.cos(a) * h);
        }
        g.strokeStyle = css(mix(stemBase, RIM, rim * 0.6), 0.9);
        g.lineWidth = stemW;
        g.stroke();
        // Heads: the top fifth, heavier.
        g.beginPath();
        for (let k = 0; k < list.length; k++) {
          const i = list[k];
          if (rank[i] >= frac) continue;
          const bx = this.baseX(x[i]), by = this.baseY(t[i]), h = this.stalkH(t[i]) * height[i];
          const a = ang[i];
          const cx = bx + Math.sin(a * 0.5) * h * 0.55, cy = by - Math.cos(a * 0.5) * h * 0.55;
          const tx = bx + Math.sin(a) * h, ty = by - Math.cos(a) * h;
          const q = 0.84, u = 1 - q;
          g.moveTo(u * u * bx + 2 * q * u * cx + q * q * tx, u * u * by + 2 * q * u * cy + q * q * ty);
          g.lineTo(tx, ty);
        }
        g.strokeStyle = css(mix(headBase, RIM, rim), 1);
        g.lineWidth = headW;
        g.stroke();
      }
    }

    g.globalCompositeOperation = "lighter";
    // Glints where a stalk just rang.
    const glint = s.glint;
    for (let i = 0; i < s.n; i++) {
      const v = glint[i];
      if (v < 0.02 || rank[i] >= frac) continue;
      const bx = this.baseX(x[i]), by = this.baseY(t[i]), h = this.stalkH(t[i]) * height[i];
      const r = (3 + 11 * t[i]) * sizeK * (0.6 + 0.4 * v);
      g.globalAlpha = v * v * (0.35 + 0.4 * t[i]);
      g.drawImage(this.glow, bx + Math.sin(ang[i]) * h - r, by - Math.cos(ang[i]) * h - r, 2 * r, 2 * r);
    }
    g.globalAlpha = 1;

    // The hand's trail.
    for (let k = 1; k < trail.length; k++) {
      const p = trail[k - 1], q = trail[k];
      const age = (now - q.time) / TRAIL_LIFE;
      if (age >= 1) continue;
      const a = (1 - age) * (1 - age);
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.lineTo(q.x, q.y);
      g.strokeStyle = `rgba(255,196,130,${0.07 * a})`;
      g.lineWidth = 14 * sizeK + 4;
      g.stroke();
      g.strokeStyle = `rgba(255,232,190,${0.22 * a})`;
      g.lineWidth = 2.2 * sizeK + 0.6;
      g.stroke();
    }

    motes.draw(g, this.glow, W, H, now);
    g.globalCompositeOperation = "source-over";

    if (hint > 0.01) {
      g.font = `italic ${Math.round(18 + 10 * sizeK)}px Georgia, "Times New Roman", serif`;
      g.textAlign = "center";
      g.fillStyle = `rgba(255,240,215,${hint})`;
      g.shadowColor = "rgba(60,20,30,0.6)";
      g.shadowBlur = 12;
      g.fillText("touch the field", W / 2, H * 0.07);
      g.shadowBlur = 0;
    }
  }
}

/** Pollen and dust drifting in the low sun. */
export class Motes {
  private x: Float32Array;
  private y: Float32Array;
  private s: Float32Array;
  private ph: Float32Array;

  constructor(seed: number, n = 56) {
    const r = mulberry32(subSeed(seed, 40));
    this.x = Float32Array.from({ length: n }, () => r());
    this.y = Float32Array.from({ length: n }, () => 0.25 + 0.6 * r());
    this.s = Float32Array.from({ length: n }, () => 0.4 + 0.6 * r());
    this.ph = Float32Array.from({ length: n }, () => r() * 100);
  }

  /** wind: signed drift, screen widths per second. */
  update(dt: number, wind: number, now: number): void {
    for (let i = 0; i < this.x.length; i++) {
      const s = this.s[i];
      this.x[i] += (0.004 + wind * s) * dt;
      this.y[i] += Math.sin(now * 0.5 + this.ph[i]) * 0.006 * dt;
      if (this.x[i] > 1.05) this.x[i] -= 1.1;
      if (this.x[i] < -0.05) this.x[i] += 1.1;
    }
  }

  draw(g: CanvasRenderingContext2D, glow: HTMLCanvasElement, W: number, H: number, now: number): void {
    for (let i = 0; i < this.x.length; i++) {
      const tw = 0.5 + 0.5 * Math.sin(now * 1.3 + this.ph[i] * 7);
      const sunNear = Math.max(0, 1 - Math.abs(this.x[i] - SUN_X) * 2.2);
      g.globalAlpha = (0.12 + 0.35 * sunNear) * tw * this.s[i];
      const r = 2 + 4 * this.s[i];
      g.drawImage(glow, this.x[i] * W - r, this.y[i] * H - r, 2 * r, 2 * r);
    }
    g.globalAlpha = 1;
  }
}

function smooth(k: number): number {
  return k * k * (3 - 2 * k);
}

function makeGlow(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,248,220,1)");
  gr.addColorStop(0.25, "rgba(255,214,140,0.7)");
  gr.addColorStop(1, "rgba(255,170,90,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return c;
}
