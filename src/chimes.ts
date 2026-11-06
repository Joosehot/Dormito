// From stalks that rang to the chimes that are played: one per pitch per ~30 ms (the merged one a
// little louder), at most a few new ones per frame, the loudest first.

import { Stalks } from "./stalks.ts";
import { noteAt } from "./scale.ts";

export interface Chime {
  midi: number;
  gain: number; // 0..~1.5 before the synth's own level
  pan: number; // -1..1
  depth: number; // 0 far .. 1 near
  detune: number; // cents
}

export class ChimeMixer {
  private pending: { i: number; intensity: number }[] = [];
  private last = new Map<number, number>();

  push(i: number, intensity: number): void {
    this.pending.push({ i, intensity });
  }

  /** The chimes to start now. */
  take(stalks: Stalks, scale: number[], root: number, now: number, maxNew: number, window = 0.03): Chime[] {
    const groups = new Map<number, { g: number; n: number; xs: number; ts: number; detune: number }>();
    for (const { i, intensity } of this.pending) {
      const t = stalks.t[i];
      const midi = noteAt(stalks.x[i], t, scale, root);
      const g = (0.22 + 0.78 * Math.pow(t, 1.3)) * (0.45 + 0.55 * intensity);
      const cur = groups.get(midi);
      if (!cur) groups.set(midi, { g, n: 1, xs: stalks.x[i], ts: t, detune: stalks.detune[i] });
      else {
        cur.n++;
        cur.xs += stalks.x[i];
        cur.ts += t;
        if (g > cur.g) {
          cur.g = g;
          cur.detune = stalks.detune[i];
        }
      }
    }
    this.pending.length = 0;
    const out: Chime[] = [];
    for (const [midi, c] of groups) {
      const prev = this.last.get(midi);
      if (prev !== undefined && now - prev < window) continue; // merged into the one just played
      out.push({
        midi,
        gain: c.g * Math.min(1.5, 1 + 0.12 * (c.n - 1)),
        pan: Math.max(-1, Math.min(1, (c.xs / c.n) * 2 - 1)) * 0.85,
        depth: c.ts / c.n,
        detune: c.detune,
      });
    }
    out.sort((a, b) => b.gain - a.gain);
    out.length = Math.min(out.length, maxNew);
    for (const c of out) this.last.set(c.midi, now);
    return out;
  }
}
