// Gusts: every so often a wide, slightly bowed wind front crosses the whole field from one side.
// The schedule comes from the seed alone, so one seed gives one gust timetable.

import { Field } from "./field.ts";
import { mulberry32, subSeed, type Rng } from "./rng.ts";

export interface Gust {
  start: number;
  dur: number;
  dir: 1 | -1;
  strength: number;
  bow: number;
  tilt: number;
}

export class Gusts {
  private rng: Rng;
  nextAt: number;
  active: Gust[] = [];
  /** The strongest gust envelope right now, 0..1, for the wind bed. */
  level = 0;

  constructor(seed: number) {
    this.rng = mulberry32(subSeed(seed, 7));
    this.nextAt = 12 + this.rng() * 8;
  }

  private make(start: number): Gust {
    const r = this.rng;
    return {
      start,
      dur: 4 + 2 * r(),
      dir: r() < 0.5 ? 1 : -1,
      strength: 0.8 + 0.4 * r(),
      bow: (r() - 0.5) * 0.5,
      tilt: (r() - 0.5) * 0.8,
    };
  }

  trigger(now: number): void {
    this.active.push(this.make(now));
  }

  /** interval: the mean seconds between gusts (spread about 40 % either way); strength scales every front. */
  update(now: number, dt: number, field: Field, interval: number, strength: number): void {
    if (now >= this.nextAt) {
      this.active.push(this.make(this.nextAt));
      this.nextAt += interval * (0.62 + 0.78 * this.rng());
    }
    const { w, h } = field;
    this.level = 0;
    this.active = this.active.filter((g) => now - g.start < g.dur);
    for (const g of this.active) {
      const p = (now - g.start) / g.dur;
      // Builds, crests a little past the middle, fades.
      const env = Math.pow(Math.sin(Math.PI * Math.pow(p, 0.8)), 2);
      this.level = Math.max(this.level, env * g.strength);
      const travel = w + 30;
      const xf = g.dir > 0 ? -15 + p * travel : w + 15 - p * travel;
      const amount = g.dir * g.strength * strength * env * 1.0 * dt;
      for (let y = 1; y < h - 1; y++) {
        const v = y / (h - 1) - 0.5;
        const x = xf + g.dir * (g.bow * w * (v * v - 1 / 12) + g.tilt * v * h);
        field.injectRow(x, y, amount, 3);
      }
    }
  }
}
