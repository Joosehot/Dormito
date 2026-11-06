// The debug panel (toggle with D): every tunable live, plus fps, voices and chimes per second.

import type { Params } from "./params.ts";
import { SCALES, ROOTS } from "./scale.ts";

interface Slider {
  key: keyof Params;
  label: string;
  min: number;
  max: number;
  step: number;
  rebuild?: boolean;
}

const SLIDERS: Slider[] = [
  { key: "c", label: "wave speed c", min: 0.1, max: 0.7, step: 0.01 },
  { key: "damping", label: "damping", min: 0.97, max: 0.999, step: 0.001 },
  { key: "brush", label: "brush strength", min: 0, max: 3, step: 0.05 },
  { key: "fieldGain", label: "stalk response", min: 0.1, max: 1, step: 0.01 },
  { key: "threshold", label: "chime threshold", min: 0.05, max: 0.6, step: 0.01 },
  { key: "cooldown", label: "cooldown s", min: 0.05, max: 1.5, step: 0.05 },
  { key: "stalkCount", label: "stalk count", min: 500, max: 6000, step: 100, rebuild: true },
  { key: "gustInterval", label: "gust interval s", min: 8, max: 90, step: 1 },
  { key: "gustStrength", label: "gust strength", min: 0, max: 3, step: 0.05 },
  { key: "reverbMix", label: "reverb mix", min: 0, max: 1, step: 0.01 },
  { key: "volume", label: "master volume", min: 0, max: 1.5, step: 0.01 },
];

export interface DebugHooks {
  rebuild(): void;
  gust(): void;
  mix(): void;
}

export class Debug {
  private el: HTMLElement;
  private stats: HTMLElement;
  private seedInput: HTMLInputElement;

  constructor(el: HTMLElement, p: Params, hooks: DebugHooks) {
    this.el = el;
    el.innerHTML = "<b>Dormito</b> &middot; D hides";
    for (const s of SLIDERS) {
      const label = document.createElement("label");
      const value = document.createElement("span");
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(s.min);
      input.max = String(s.max);
      input.step = String(s.step);
      input.value = String(p[s.key]);
      const show = () => (value.textContent = String(p[s.key]));
      show();
      input.addEventListener("input", () => {
        (p as any)[s.key] = Number(input.value);
        show();
        if (!s.rebuild) hooks.mix();
      });
      if (s.rebuild) input.addEventListener("change", () => hooks.rebuild());
      label.append(`${s.label} `, value, input);
      el.append(label);
    }

    const scaleSel = select(Object.keys(SCALES), p.scale, (v) => (p.scale = v));
    const rootSel = select(ROOTS, ROOTS[p.root], (v) => (p.root = ROOTS.indexOf(v)));
    const row1 = div("row");
    row1.append(scaleSel, rootSel);
    el.append(row1);

    this.seedInput = document.createElement("input");
    this.seedInput.type = "number";
    this.seedInput.value = String(p.seed);
    this.seedInput.style.width = "90px";
    this.seedInput.addEventListener("change", () => {
      p.seed = Math.max(1, Math.floor(Number(this.seedInput.value)) || 1);
      hooks.rebuild();
    });
    const reroll = button("reroll", () => {
      p.seed = 1 + Math.floor(Math.random() * 999999);
      this.seedInput.value = String(p.seed);
      hooks.rebuild();
    });
    const row2 = div("row");
    row2.append("seed ", this.seedInput, reroll);
    el.append(row2);

    const row3 = div("row");
    row3.append(button("trigger gust now", () => hooks.gust()));
    el.append(row3);

    this.stats = div("stats");
    el.append(this.stats);
  }

  get open(): boolean {
    return this.el.classList.contains("open");
  }

  toggle(): void {
    this.el.classList.toggle("open");
  }

  setStats(text: string): void {
    if (this.open) this.stats.textContent = text;
  }
}

function div(cls: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = cls;
  return d;
}

function button(text: string, on: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = text;
  b.addEventListener("click", on);
  return b;
}

function select(options: string[], value: string, on: (v: string) => void): HTMLSelectElement {
  const s = document.createElement("select");
  for (const o of options) s.append(new Option(o, o, false, o === value));
  s.addEventListener("change", () => on(s.value));
  return s;
}
