// All sound, synthesized: glassy little bells, a wind bed that follows the field, a warm generated
// reverb and a chain that cannot clip. Built on the first press (browsers start audio only then).

import type { Chime } from "./chimes.ts";
import { midiToHz } from "./scale.ts";
import { mulberry32, subSeed } from "./rng.ts";

const PARTIALS: [number, number][] = [
  [1, 1],
  [2.76, 0.3],
  [5.4, 0.1],
];

interface Voice {
  start: number;
  tau: number;
  peak: number;
  end: number;
  out: GainNode;
  oscs: OscillatorNode[];
}

export class Audio {
  readonly ctx: AudioContext;
  private chimeBus: GainNode;
  private reverbIn: GainNode;
  private dry: GainNode;
  private wet: GainNode;
  private master: GainNode;
  private windFilter: BiquadFilterNode;
  private windGain: GainNode;
  private voices: Voice[] = [];
  maxVoices = 48;

  constructor(seed: number) {
    const ctx = (this.ctx = new AudioContext({ latencyHint: "interactive" }));

    this.chimeBus = ctx.createGain();
    this.chimeBus.gain.value = 0.55;
    this.reverbIn = ctx.createGain();

    const reverb = ctx.createConvolver();
    reverb.buffer = this.impulse(seed, 3.5);
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();

    // Gentle glue, then the volume, then a hard ceiling and a soft clip that only a freak peak reaches.
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -20;
    glue.knee.value = 18;
    glue.ratio.value = 2.5;
    glue.attack.value = 0.01;
    glue.release.value = 0.3;
    this.master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.12;
    const clip = ctx.createWaveShaper();
    clip.curve = softClip();

    this.chimeBus.connect(this.dry).connect(glue);
    this.reverbIn.connect(reverb).connect(this.wet).connect(glue);
    glue.connect(this.master).connect(limiter).connect(clip).connect(ctx.destination);

    // The wind: looped pink noise through a band that opens as the field fills with energy.
    const noise = ctx.createBufferSource();
    noise.buffer = pinkNoise(ctx, 4, seed);
    noise.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = 450;
    this.windFilter.Q.value = 0.8;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.0;
    noise.connect(this.windFilter).connect(this.windGain).connect(glue);
    this.windGain.connect(this.reverbIn);
    noise.start();
  }

  resume(): Promise<void> {
    return this.ctx.resume();
  }

  setMix(reverbMix: number, volume: number): void {
    const t = this.ctx.currentTime;
    this.dry.gain.setTargetAtTime(1 - 0.45 * reverbMix, t, 0.05);
    this.wet.gain.setTargetAtTime(1.6 * reverbMix, t, 0.05);
    this.master.gain.setTargetAtTime(volume, t, 0.05);
  }

  /** energy01: how full of motion the field is, 0..1. */
  wind(energy01: number): void {
    const t = this.ctx.currentTime;
    const e = Math.min(1, Math.max(0, energy01));
    this.windGain.gain.setTargetAtTime(0.012 + 0.11 * e, t, 0.25);
    this.windFilter.frequency.setTargetAtTime(400 + 500 * e, t, 0.3);
  }

  get active(): number {
    const now = this.ctx.currentTime;
    this.voices = this.voices.filter((v) => v.end > now);
    return this.voices.length;
  }

  play(c: Chime): void {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (this.active >= this.maxVoices) this.steal(now);

    const t0 = now + 0.004;
    const freq = midiToHz(c.midi, c.detune);
    const hi = Math.min(1, Math.max(0, (c.midi - 62) / 36));
    const decay = 1.5 - 0.9 * hi; // seconds until it is all but gone
    const tau = decay / 3.5;
    const attack = 0.005 - 0.003 * hi;
    const peak = 0.16 * c.gain;
    const near = c.depth;

    const out = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2600 + 7400 * near * near;
    lp.Q.value = 0.4;
    const pan = ctx.createStereoPanner();
    pan.pan.value = c.pan;
    const send = ctx.createGain();
    send.gain.value = 0.35 + 0.65 * (1 - near);
    out.connect(lp).connect(pan);
    pan.connect(this.chimeBus);
    pan.connect(send).connect(this.reverbIn);

    const oscs: OscillatorNode[] = [];
    for (const [ratio, amp] of PARTIALS) {
      const f = freq * ratio;
      if (f > 14000) continue;
      const osc = ctx.createOscillator();
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(peak * amp, t0 + attack);
      g.gain.setTargetAtTime(0, t0 + attack, tau / Math.pow(ratio, 0.7));
      osc.connect(g).connect(out);
      osc.start(t0);
      osc.stop(t0 + decay * 1.3);
      oscs.push(osc);
    }
    oscs[0].onended = () => {
      pan.disconnect();
      send.disconnect();
    };
    this.voices.push({ start: t0, tau, peak, end: t0 + decay * 1.3, out, oscs });
  }

  /** Free a voice for a new one: the quietest by now, which is mostly the oldest. */
  private steal(now: number): void {
    let k = 0, least = Infinity;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      const level = v.peak * Math.exp(-Math.max(0, now - v.start) / v.tau);
      if (level < least) {
        least = level;
        k = i;
      }
    }
    const v = this.voices[k];
    v.out.gain.setTargetAtTime(0, now, 0.006);
    for (const o of v.oscs) o.stop(now + 0.04);
    this.voices.splice(k, 1);
  }

  /** A warm stereo hall: noise under an exponential tail that darkens as it decays. */
  private impulse(seed: number, seconds: number): AudioBuffer {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = this.ctx.createBuffer(2, len, sr);
    const pre = Math.floor(sr * 0.018);
    for (let ch = 0; ch < 2; ch++) {
      const rng = mulberry32(subSeed(seed, 20 + ch));
      const d = buf.getChannelData(ch);
      let y = 0;
      for (let i = pre; i < len; i++) {
        const s = (i - pre) / sr;
        const a = 0.55 * Math.exp(-s * 1.4) + 0.04; // brightness falls with time
        y += a * (rng() * 2 - 1 - y);
        d[i] = y * Math.exp((-6.9 * s) / seconds);
      }
    }
    let peak = 0;
    for (let ch = 0; ch < 2; ch++) for (const v of buf.getChannelData(ch)) peak = Math.max(peak, Math.abs(v));
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] *= 0.5 / peak;
    }
    return buf;
  }
}

function softClip(): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    curve[i] = a < 0.8 ? x : Math.sign(x) * (0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2));
  }
  return curve;
}

function pinkNoise(ctx: AudioContext, seconds: number, seed: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const fade = Math.floor(ctx.sampleRate * 0.05);
  const gen = new Float32Array(len + fade);
  const rng = mulberry32(subSeed(seed, 30));
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < gen.length; i++) {
    const w = rng() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    gen[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
  }
  // The loop's start is faded in from what would have followed its end, so the seam is seamless.
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = gen[i];
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    d[i] = gen[i] * k + gen[len + i] * (1 - k);
  }
  return buf;
}
