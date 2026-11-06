// Pitch from place: x walks up two octaves of the scale, the near half of the field sounds an octave higher.

export const SCALES: Record<string, number[]> = {
  "major pentatonic": [0, 2, 4, 7, 9],
  "minor pentatonic": [0, 3, 5, 7, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};

export const ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** MIDI note of a stalk at x (0..1) and depth t (0..1). root is 0..11 (2 = D); the far, lowest notes start at octave 4. */
export function noteAt(x: number, t: number, scale: number[], root: number): number {
  const steps = scale.length * 2;
  const deg = Math.min(steps - 1, Math.max(0, Math.floor(x * steps)));
  const octave = Math.floor(deg / scale.length) + (t > 0.45 ? 1 : 0);
  return 60 + root + 12 * octave + scale[deg % scale.length];
}

export function midiToHz(midi: number, cents = 0): number {
  return 440 * Math.pow(2, (midi - 69 + cents / 100) / 12);
}
