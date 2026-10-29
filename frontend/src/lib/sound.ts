/**
 * Tiny sound engine: no assets, no network requests — everything is synthesized with WebAudio.
 *
 * - The AudioContext is created only after the first user gesture (browser autoplay policy)
 * - The global mute switch persists to localStorage (sound on by default, mixed low)
 * - Every cue is a short sine/triangle envelope: no harsh transients, nothing intrusive
 */

type Cue = "click" | "success" | "error" | "claim" | "toggle" | "open";

const MUTE_KEY = "aura.sound.muted";
let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.16; // Master level: present but never loud
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function blip(freq: number, when: number, dur: number, type: OscillatorType, gain = 0.5, slideTo?: number) {
  const ac = ensureCtx();
  if (!ac || !master) return;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, when);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, when + dur);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(gain, when + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(when);
  osc.stop(when + dur + 0.02);
}

export function isMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMuted(v: boolean): void {
  try {
    window.localStorage.setItem(MUTE_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("aura:sound", { detail: { muted: v } }));
}

export function play(cue: Cue): void {
  if (isMuted()) return;
  const ac = ensureCtx();
  if (!ac) return;
  const t = ac.currentTime + 0.001;
  switch (cue) {
    case "click":
      blip(1180, t, 0.05, "triangle", 0.35);
      break;
    case "toggle":
      blip(720, t, 0.06, "sine", 0.3, 980);
      break;
    case "open":
      blip(520, t, 0.09, "sine", 0.28, 760);
      break;
    case "success":
      // Crisp two-note rise (trade filled)
      blip(880, t, 0.08, "triangle", 0.42);
      blip(1320, t + 0.075, 0.12, "triangle", 0.34);
      blip(1760, t + 0.15, 0.1, "sine", 0.16);
      break;
    case "claim":
      blip(660, t, 0.07, "square", 0.22);
      blip(990, t + 0.06, 0.09, "square", 0.18);
      blip(1480, t + 0.13, 0.16, "triangle", 0.26);
      break;
    case "error":
      blip(300, t, 0.14, "sawtooth", 0.22, 180);
      break;
  }
}
