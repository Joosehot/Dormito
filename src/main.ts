// Dormito: the loop and the hand. The simulation runs at a fixed 120 Hz behind an accumulator;
// drawing and the chime dispatch run once per frame.

import { Field, brush } from "./field.ts";
import { Stalks } from "./stalks.ts";
import { Gusts } from "./gusts.ts";
import { ChimeMixer } from "./chimes.ts";
import { Audio } from "./audio.ts";
import { SCALES } from "./scale.ts";
import { Renderer, Motes, type TrailPoint } from "./render.ts";
import { Debug } from "./debug.ts";
import { DEFAULTS, SIM_HZ, GRID_W, GRID_H, type Params } from "./params.ts";

const SIM_DT = 1 / SIM_HZ;
const coarse = matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) < 600;

const query = new URLSearchParams(location.search);
const urlSeed = Number(query.get("seed"));
const params: Params = {
  ...DEFAULTS,
  stalkCount: coarse ? 2000 : DEFAULTS.stalkCount,
  seed: urlSeed > 0 ? Math.floor(urlSeed) : 1 + Math.floor(Math.random() * 999999),
};

const renderer = new Renderer(document.getElementById("field") as HTMLCanvasElement, coarse ? 1.5 : 2);
let field!: Field, stalks!: Stalks, gusts!: Gusts, motes!: Motes;
const mixer = new ChimeMixer();
let simTime = 0;
let audio: Audio | null = null;

function rebuild(): void {
  field = new Field(GRID_W, GRID_H);
  stalks = new Stalks(params.seed, params.stalkCount);
  gusts = new Gusts(params.seed);
  motes = new Motes(params.seed);
  simTime = 0;
  renderer.setStalks(stalks);
  query.set("seed", String(params.seed));
  history.replaceState(null, "", `?${query}`.replace(/=(&|$)/g, "$1"));
}
rebuild();

const debug = new Debug(document.getElementById("debug")!, params, {
  rebuild,
  gust: () => gusts.trigger(simTime),
  mix: () => audio?.setMix(params.reverbMix, params.volume),
});
addEventListener("keydown", (e) => {
  if (e.key === "d" || e.key === "D") debug.toggle();
});
addEventListener("resize", () => renderer.resize());

// --- The hand ---------------------------------------------------------------------------------

interface Segment {
  x0: number; y0: number; x1: number; y1: number; seconds: number;
}
const segments: Segment[] = [];
const trail: TrailPoint[] = [];
const hands = new Map<number, { x: number; t: number; time: number }>();
let hintFade = 0; // grows once audio is unlocked

function toGrid(f: { x: number; t: number }): [number, number] {
  return [f.x * (GRID_W - 1), Math.min(GRID_H - 1.5, Math.max(0.5, f.t * (GRID_H - 1)))];
}

function moveHand(id: number, sx: number, sy: number, timeMs: number): void {
  const f = renderer.toField(sx, sy);
  const time = timeMs / 1000;
  const last = hands.get(id);
  if (last && f.t > -0.08 && last.t > -0.08) {
    const [x0, y0] = toGrid(last), [x1, y1] = toGrid(f);
    segments.push({ x0, y0, x1, y1, seconds: Math.max(1 / 240, time - last.time) });
  }
  hands.set(id, { x: f.x, t: f.t, time });
  trail.push({ x: sx, y: sy, time: performance.now() / 1000 });
  if (trail.length > 400) trail.splice(0, trail.length - 400);
}

const canvas = renderer.canvas;
function unlockAudio(): void {
  if (!audio) {
    audio = new Audio(params.seed);
    audio.maxVoices = params.maxVoices;
    audio.setMix(params.reverbMix, params.volume);
  }
  void audio.resume();
}

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  unlockAudio();
  hands.delete(e.pointerId);
  moveHand(e.pointerId, e.offsetX, e.offsetY, e.timeStamp);
});
canvas.addEventListener("pointermove", (e) => {
  // A mouse brushes just by moving; a finger or pen while it touches.
  if (e.pointerType !== "mouse" && e.buttons === 0) return;
  const events = e.getCoalescedEvents?.() ?? [e];
  for (const c of events.length ? events : [e]) moveHand(e.pointerId, c.offsetX, c.offsetY, c.timeStamp);
});
const lift = (e: PointerEvent) => hands.delete(e.pointerId);
canvas.addEventListener("pointerup", lift);
canvas.addEventListener("pointercancel", lift);
canvas.addEventListener("pointerleave", lift);

// ?demo[=seconds]: a gust and a swipe with no hand, to see the field move; with seconds, the field
// is first run that far ahead (for screenshots, where the browser's clock does not move).
const demo = query.get("demo");
function startDemo(): void {
  gusts.trigger(simTime);
  segments.push({ x0: 15, y0: GRID_H * 0.75, x1: 145, y1: GRID_H * 0.65, seconds: 0.35 });
  for (let k = Math.round(Number(demo) * SIM_HZ) || 0; k > 0; k--) simStep();
}
if (query.has("debug")) debug.toggle();

// --- The loop ---------------------------------------------------------------------------------

let energy = 0;
let stepCount = 0;
function simStep(): void {
  for (const s of segments) brush(field, s.x0, s.y0, s.x1, s.y1, s.seconds, params.brush);
  segments.length = 0;
  gusts.update(simTime, SIM_DT, field, params.gustInterval, params.gustStrength);
  field.step(params.c * params.c, params.damping);
  stalks.step(SIM_DT, simTime, field, params, (i, intensity) => mixer.push(i, intensity));
  if (++stepCount % 6 === 0) energy = field.energy();
  simTime += SIM_DT;
}

if (demo !== null) {
  startDemo();
  unlockAudio(); // sounds only where the browser lets audio start without a touch
  let peak = 0;
  const watch = setInterval(() => (peak = Math.max(peak, audio?.active ?? 0)), 50);
  setTimeout(() => {
    clearInterval(watch);
    console.info(`demo: audio ${audio?.ctx.state}, voices peak ${peak}, chimes in the last second ${chimeTimes.length}`);
  }, 2500);
}

let last = performance.now();
let acc = 0;
let fps = 60, workMs = 0, slowFor = 0, fastFor = 0;
const chimeTimes: number[] = [];

function frame(nowMs: number): void {
  const t0 = performance.now();
  const dt = Math.min(0.1, (nowMs - last) / 1000);
  last = nowMs;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;

  acc += dt;
  let n = 0;
  while (acc >= SIM_DT && n < 12) {
    simStep();
    acc -= SIM_DT;
    n++;
  }
  if (n === 12) acc = 0;

  const chimes = mixer.take(stalks, SCALES[params.scale], params.root, simTime, params.maxNewPerFrame);
  const now = performance.now() / 1000;
  if (audio && audio.ctx.state === "running") {
    for (const c of chimes) {
      audio.play(c);
      chimeTimes.push(now);
    }
    audio.wind(Math.max(gusts.level * 0.85, 1 - Math.exp(-energy / 0.08)));
    hintFade = Math.min(1, hintFade + dt / 1.2);
  }
  while (chimeTimes.length && chimeTimes[0] < now - 1) chimeTimes.shift();

  const windDrift = gusts.active.reduce((w, g) => w + g.dir * 0.05 * gusts.level, 0);
  motes.update(dt, windDrift, simTime);
  while (trail.length && now - trail[0].time > 2.6) trail.shift();
  const hint = (1 - hintFade) * (0.55 + 0.3 * Math.sin(now * 1.6));
  renderer.draw(trail, motes, now, hint);

  // Keep the frame in budget: thin the field when it runs slow, fill it back when there is room.
  workMs += (performance.now() - t0 - workMs) * 0.1;
  if (workMs > 12) {
    slowFor += dt;
    fastFor = 0;
  } else if (workMs < 7) {
    fastFor += dt;
    slowFor = 0;
  } else slowFor = fastFor = 0;
  if (slowFor > 1 && stalks.activeFrac > 0.25) {
    stalks.activeFrac *= 0.85;
    slowFor = 0;
  }
  if (fastFor > 4 && stalks.activeFrac < 1) {
    stalks.activeFrac = Math.min(1, stalks.activeFrac * 1.05);
    fastFor = 0;
  }

  debug.setStats(
    `fps          ${fps.toFixed(0)}\n` +
      `frame work   ${workMs.toFixed(1)} ms\n` +
      `stalks       ${Math.round(stalks.n * stalks.activeFrac)} / ${stalks.n}\n` +
      `voices       ${audio ? audio.active : 0} / ${params.maxVoices}\n` +
      `chimes/s     ${chimeTimes.length}\n` +
      `next gust    ${Math.max(0, gusts.nextAt - simTime).toFixed(0)} s\n` +
      `field energy ${energy.toFixed(3)}\n` +
      `seed         ${params.seed}`,
  );
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
