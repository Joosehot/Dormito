// The wheat: stalks spread evenly over a square patch of ground, each a damped spring driven by the
// field under it. A stalk chimes when its bend rises through the threshold.
// The patch is seen as a diamond: corner (u, v) = (0, 0) at the top, (1, 0) right, (0, 1) left,
// (1, 1) bottom; so across the screen x = (u − v + 1) / 2 and depth t = (u + v) / 2.

import { Field } from "./field.ts";
import { mulberry32, subSeed, Noise1 } from "./rng.ts";

export interface StalkParams {
  fieldGain: number; // radians of bend per unit of field
  threshold: number; // radians of bend that ring a chime
  cooldown: number; // seconds before the same stalk may ring again
  breeze: number; // radians of slow constant sway
}

export type Fire = (i: number, intensity: number) => void;

export class Stalks {
  readonly n: number;
  /** Place on the patch, 0..1 each. */
  readonly u: Float32Array;
  readonly v: Float32Array;
  /** 0..1 across the screen (left corner to right corner). */
  readonly x: Float32Array;
  /** Depth 0 (top corner) .. 1 (bottom corner), sorted ascending so index order is back to front. */
  readonly t: Float32Array;
  readonly height: Float32Array; // relative to the near height
  readonly lean: Float32Array; // resting bend
  readonly omega: Float32Array;
  readonly zeta: Float32Array;
  readonly tone: Float32Array; // colour jitter -1..1
  readonly detune: Float32Array; // cents, ±3
  readonly rank: Float32Array; // 0..1; a stalk is drawn and simulated while rank < activeFrac
  readonly ang: Float32Array;
  readonly vel: Float32Array;
  readonly glint: Float32Array;
  private bendPrev: Float32Array;
  private cool: Float32Array;
  private noise: Noise1;
  activeFrac = 1;

  constructor(seed: number, count: number) {
    const rng = mulberry32(subSeed(seed, 3));
    const n = (this.n = count);
    const items: number[][] = [];
    for (let i = 0; i < n; i++) {
      const u = 0.02 + 0.96 * rng(), v = 0.02 + 0.96 * rng();
      items.push([
        (u - v + 1) / 2,
        (u + v) / 2,
        0.8 + 0.4 * rng(),
        (rng() - 0.5) * 0.12 + 0.04,
        2 * Math.PI * (1.9 + 1.2 * rng()),
        0.24 + 0.1 * rng(),
        rng() * 2 - 1,
        (rng() * 2 - 1) * 3,
        rng(),
        u,
        v,
      ]);
    }
    items.sort((a, b) => a[1] - b[1]);
    const col = (k: number) => Float32Array.from(items, (it) => it[k]);
    this.u = col(9);
    this.v = col(10);
    this.x = col(0);
    this.t = col(1);
    this.height = col(2);
    this.lean = col(3);
    this.omega = col(4);
    this.zeta = col(5);
    this.tone = col(6);
    this.detune = col(7);
    this.rank = col(8);
    this.ang = Float32Array.from(this.lean);
    this.vel = new Float32Array(n);
    this.glint = new Float32Array(n);
    this.bendPrev = new Float32Array(n);
    this.cool = new Float32Array(n);
    this.noise = new Noise1(mulberry32(subSeed(seed, 11)));
  }

  step(dt: number, now: number, field: Field, p: StalkParams, fire: Fire): void {
    const { u, v, x, t, lean, omega, zeta, ang, vel, glint, bendPrev, cool, rank, noise } = this;
    const gw = field.w - 1, gh = field.h - 1;
    const thr = p.threshold;
    const fade = dt / 0.3;
    for (let i = 0; i < this.n; i++) {
      if (glint[i] > 0) glint[i] = Math.max(0, glint[i] - fade);
      if (rank[i] >= this.activeFrac) continue;
      const push = field.sample(u[i] * gw, v[i] * gh);
      const breeze = p.breeze * noise.at(x[i] * 5 + t[i] * 3 + now * 0.35);
      const target = lean[i] + p.fieldGain * push + breeze;
      const w0 = omega[i];
      vel[i] += (w0 * w0 * (target - ang[i]) - 2 * zeta[i] * w0 * vel[i]) * dt;
      ang[i] += vel[i] * dt;
      const b = Math.abs(ang[i] - lean[i]);
      if (b > thr && bendPrev[i] <= thr && now >= cool[i]) {
        cool[i] = now + p.cooldown;
        glint[i] = 1;
        fire(i, Math.min(1, Math.abs(vel[i]) / (thr * w0 * 1.6)));
      }
      bendPrev[i] = b;
    }
  }
}
