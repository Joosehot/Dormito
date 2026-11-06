// Every tunable in one place; the debug panel edits these live.

export interface Params {
  c: number; // wave speed, cells per sim step
  damping: number; // per sim step
  brush: number;
  fieldGain: number;
  threshold: number;
  cooldown: number;
  stalkCount: number;
  gustInterval: number; // mean seconds between gusts
  gustStrength: number;
  breeze: number;
  reverbMix: number;
  volume: number;
  scale: string;
  root: number; // 0..11, 2 = D
  seed: number;
  maxVoices: number;
  maxNewPerFrame: number;
}

export const DEFAULTS: Params = {
  c: 0.42,
  damping: 0.989,
  brush: 1,
  fieldGain: 0.35,
  threshold: 0.2,
  cooldown: 0.4,
  stalkCount: 2600,
  gustInterval: 32,
  gustStrength: 1,
  breeze: 0.05,
  reverbMix: 0.45,
  volume: 0.8,
  scale: "major pentatonic",
  root: 2,
  seed: 1,
  maxVoices: 48,
  maxNewPerFrame: 6,
};

export const SIM_HZ = 120;
// The field is a square patch of ground (seen as a diamond), so its grid is square too.
export const GRID_W = 110;
export const GRID_H = 110;
