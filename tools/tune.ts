// Runs the field, stalks, gusts and chime mixer without a browser, for the four acceptance moves:
// idle breeze, a slow brush, a fast swipe, a gust. Prints what would be heard.
// node tools/tune.ts [key=value ...]   (any Params key, e.g. threshold=0.22)

import { Field, brush } from "../src/field.ts";
import { Stalks } from "../src/stalks.ts";
import { Gusts } from "../src/gusts.ts";
import { ChimeMixer, type Chime } from "../src/chimes.ts";
import { SCALES, ROOTS } from "../src/scale.ts";
import { DEFAULTS, SIM_HZ, GRID_W, GRID_H, type Params } from "../src/params.ts";

const p: Params = { ...DEFAULTS };
for (const a of process.argv.slice(2)) {
  const [k, v] = a.split("=");
  (p as any)[k] = isNaN(Number(v)) ? v : Number(v);
}
const DT = 1 / SIM_HZ;

function decayOf(midi: number): number {
  const s = Math.min(1, Math.max(0, (midi - 62) / 36));
  return 1.5 - 0.9 * s;
}

interface Stroke { from: [number, number]; to: [number, number]; start: number; dur: number }

function run(name: string, seconds: number, strokes: Stroke[], gustAt: number | null) {
  const field = new Field(GRID_W, GRID_H);
  const stalks = new Stalks(p.seed, p.stalkCount);
  const gusts = new Gusts(p.seed);
  gusts.nextAt = 1e9; // only the gust this scene asks for
  const mixer = new ChimeMixer();
  let maxE = 0, fires = 0, maxU = 0, peakVoices = 0, stolen = 0, lastChime = 0;
  const voices: number[] = []; // end times
  const played: { time: number; c: Chime }[] = [];
  const scale = SCALES[p.scale];
  const steps = Math.round(seconds * SIM_HZ);
  for (let s = 0; s < steps; s++) {
    const now = s * DT;
    if (gustAt !== null && Math.abs(now - gustAt) < DT / 2) gusts.trigger(now);
    for (const st of strokes) {
      const a = (now - st.start) / st.dur, b = (now + DT - st.start) / st.dur;
      if (b <= 0 || a >= 1) continue;
      const lerp = (q: number, k: number) => st.from[k] + (st.to[k] - st.from[k]) * Math.min(1, Math.max(0, q));
      brush(field, lerp(a, 0), lerp(a, 1), lerp(b, 0), lerp(b, 1), DT, p.brush);
    }
    gusts.update(now, DT, field, p.gustInterval, p.gustStrength);
    field.step(p.c * p.c, p.damping);
    stalks.step(DT, now, field, p, (i, intensity) => {
      fires++;
      mixer.push(i, intensity);
    });
    if (s % 2 === 1) {
      // a 60 Hz frame
      for (let k = voices.length - 1; k >= 0; k--) if (voices[k] <= now) voices.splice(k, 1);
      for (const c of mixer.take(stalks, scale, p.root, now, p.maxNewPerFrame)) {
        if (voices.length >= p.maxVoices) {
          voices.sort((x, y) => x - y);
          voices.shift();
          stolen++;
        }
        voices.push(now + decayOf(c.midi));
        played.push({ time: now, c });
        lastChime = now;
      }
      peakVoices = Math.max(peakVoices, voices.length);
    }
    if (s % 12 === 0) maxE = Math.max(maxE, field.energy());
    if (s % 12 === 0) for (let i = 0; i < field.cur.length; i++) maxU = Math.max(maxU, Math.abs(field.cur[i]));
  }
  const name12 = (m: number) => ROOTS[m % 12] + Math.floor(m / 12 - 1);
  const firstNotes = played.slice(0, 14).map((q) => name12(q.c.midi)).join(" ");
  let maxRate = 0;
  for (const q of played) maxRate = Math.max(maxRate, played.filter((r) => r.time >= q.time && r.time < q.time + 1).length);
  console.log(
    `${name.padEnd(10)} stalks rang ${String(fires).padStart(5)}  chimes ${String(played.length).padStart(4)}  ` +
      `peak/s ${String(maxRate).padStart(3)}  voices peak ${String(peakVoices).padStart(2)} stolen ${String(stolen).padStart(3)}  ` +
      `max|u| ${maxU.toFixed(2)}  last ${lastChime.toFixed(1)} s  maxE ${maxE.toFixed(3)}`,
  );
  if (played.length) console.log(`           ${firstNotes}${played.length > 14 ? " ..." : ""}`);
}

// Strokes in grid cells; the patch is GRID_W × GRID_H, seen as a diamond.
const [W, H] = [GRID_W, GRID_H];
run("idle", 12, [], null);
run("slow", 6, [{ from: [W * 0.35, H * 0.6], to: [W * 0.55, H * 0.45], start: 0.2, dur: 2.5 }], null);
run("fast", 6, [{ from: [W * 0.12, H * 0.92], to: [W * 0.95, H * 0.15], start: 0.2, dur: 0.35 }], null);
run("gust", 9, [], 0.2);
