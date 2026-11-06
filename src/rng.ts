// Seeded randomness: mulberry32, independent sub-streams per purpose, and a smooth 1D value noise.

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seed for one purpose (layout, gusts, reverb...), so changing one stream never shifts another. */
export function subSeed(seed: number, salt: number): number {
  let h = (seed ^ Math.imul(salt + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Smooth value noise on the line, in [-1, 1]. */
export class Noise1 {
  private table = new Float32Array(256);

  constructor(rng: Rng) {
    for (let i = 0; i < 256; i++) this.table[i] = rng() * 2 - 1;
  }

  at(x: number): number {
    const i = Math.floor(x);
    const f = x - i;
    const a = this.table[i & 255];
    const b = this.table[(i + 1) & 255];
    return a + (b - a) * f * f * (3 - 2 * f);
  }
}
