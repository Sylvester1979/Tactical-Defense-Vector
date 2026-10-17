// Procedural sound effects on the Web Audio API — every sound is synthesized from oscillators
// and filtered noise, so the game ships no audio files. Voices take any BaseAudioContext, so the
// same definitions can also be rendered offline.

export type SoundName =
  | 'vulcan' | 'vulcanHeavy' | 'railgun' | 'railgunHyper' | 'mortar' | 'cryoLaunch'
  | 'explosion' | 'freeze' | 'death' | 'deathBoss' | 'leak'
  | 'waveStart' | 'bossWarn' | 'waveClear' | 'gameOver'
  | 'place' | 'upgrade' | 'specialize' | 'sell' | 'error';

type Voice = (ac: BaseAudioContext, out: AudioNode, t: number) => number; // returns duration (s)

// ── Building blocks ───────────────────────────────────────────────────────

interface ToneOpts { type?: OscillatorType; freq: number; freqEnd?: number; dur: number; gain: number; attack?: number; at?: number }
const tone = (ac: BaseAudioContext, out: AudioNode, t0: number, o: ToneOpts) => {
  const t = t0 + (o.at ?? 0);
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, t);
  if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, t + o.dur);
  const a = o.attack ?? 0.004;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + o.dur + 0.02);
  return (o.at ?? 0) + o.dur;
};

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
const noiseBuffer = (ac: BaseAudioContext) => {
  let buf = noiseBuffers.get(ac);
  if (!buf) {
    buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ac, buf);
  }
  return buf;
};

interface NoiseOpts { filter: BiquadFilterType; freq: number; freqEnd?: number; q?: number; dur: number; gain: number; attack?: number; at?: number }
const noise = (ac: BaseAudioContext, out: AudioNode, t0: number, o: NoiseOpts) => {
  const t = t0 + (o.at ?? 0);
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac);
  const f = ac.createBiquadFilter();
  f.type = o.filter;
  f.frequency.setValueAtTime(o.freq, t);
  if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t + o.dur);
  f.Q.value = o.q ?? 0.8;
  const g = ac.createGain();
  const a = o.attack ?? 0.003;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 1.5);
  src.stop(t + o.dur + 0.02);
  return (o.at ?? 0) + o.dur;
};

const longest = (...durs: number[]) => Math.max(...durs);

// ── Voices ────────────────────────────────────────────────────────────────

const VOICES: Record<SoundName, Voice> = {
  // Weapons
  vulcan: (ac, out, t) => longest(
    tone(ac, out, t, { type: 'square', freq: 1100, freqEnd: 520, dur: 0.045, gain: 0.05 }),
    noise(ac, out, t, { filter: 'highpass', freq: 2500, dur: 0.035, gain: 0.07 }),
  ),
  vulcanHeavy: (ac, out, t) => longest(
    tone(ac, out, t, { type: 'square', freq: 420, freqEnd: 160, dur: 0.07, gain: 0.07 }),
    noise(ac, out, t, { filter: 'bandpass', freq: 1400, dur: 0.06, gain: 0.1 }),
  ),
  railgun: (ac, out, t) => longest(
    tone(ac, out, t, { type: 'sawtooth', freq: 260, freqEnd: 1600, dur: 0.09, gain: 0.06 }),
    tone(ac, out, t, { type: 'sine', freq: 2400, freqEnd: 700, dur: 0.16, gain: 0.05, at: 0.02 }),
    noise(ac, out, t, { filter: 'highpass', freq: 3000, dur: 0.12, gain: 0.05, at: 0.02 }),
  ),
  railgunHyper: (ac, out, t) => longest(
    tone(ac, out, t, { type: 'sawtooth', freq: 90, freqEnd: 900, dur: 0.22, gain: 0.07, attack: 0.06 }),
    tone(ac, out, t, { type: 'sine', freq: 1800, freqEnd: 300, dur: 0.3, gain: 0.07, at: 0.2 }),
    noise(ac, out, t, { filter: 'lowpass', freq: 3000, freqEnd: 300, dur: 0.3, gain: 0.12, at: 0.2 }),
  ),
  mortar: (ac, out, t) => longest(
    tone(ac, out, t, { type: 'sine', freq: 150, freqEnd: 45, dur: 0.2, gain: 0.2 }),
    noise(ac, out, t, { filter: 'lowpass', freq: 900, freqEnd: 200, dur: 0.14, gain: 0.12 }),
  ),
  cryoLaunch: (ac, out, t) => longest(
    tone(ac, out, t, { type: 'sine', freq: 140, freqEnd: 50, dur: 0.18, gain: 0.16 }),
    tone(ac, out, t, { type: 'triangle', freq: 1800, freqEnd: 2700, dur: 0.18, gain: 0.03, at: 0.02 }),
  ),

  // Impacts & deaths
  explosion: (ac, out, t) => longest(
    noise(ac, out, t, { filter: 'lowpass', freq: 1200, freqEnd: 150, dur: 0.45, gain: 0.25 }),
    tone(ac, out, t, { type: 'sine', freq: 95, freqEnd: 35, dur: 0.35, gain: 0.22 }),
  ),
  freeze: (ac, out, t) => longest(
    noise(ac, out, t, { filter: 'highpass', freq: 4500, dur: 0.3, gain: 0.08 }),
    tone(ac, out, t, { type: 'triangle', freq: 2600, freqEnd: 1900, dur: 0.25, gain: 0.04 }),
    tone(ac, out, t, { type: 'sine', freq: 110, freqEnd: 50, dur: 0.2, gain: 0.12 }),
  ),
  death: (ac, out, t) => longest(
    tone(ac, out, t, { type: 'square', freq: 680, freqEnd: 140, dur: 0.1, gain: 0.04 }),
    noise(ac, out, t, { filter: 'bandpass', freq: 1600, dur: 0.07, gain: 0.06 }),
  ),
  deathBoss: (ac, out, t) => longest(
    noise(ac, out, t, { filter: 'lowpass', freq: 1800, freqEnd: 80, dur: 1.4, gain: 0.35 }),
    tone(ac, out, t, { type: 'sine', freq: 70, freqEnd: 25, dur: 1.2, gain: 0.35 }),
    noise(ac, out, t, { filter: 'bandpass', freq: 600, dur: 0.6, gain: 0.15, at: 0.25 }),
  ),
  leak: (ac, out, t) => longest(
    tone(ac, out, t, { type: 'sawtooth', freq: 220, dur: 0.34, gain: 0.06, attack: 0.01 }),
    tone(ac, out, t, { type: 'sawtooth', freq: 233, dur: 0.34, gain: 0.06, attack: 0.01 }),
    tone(ac, out, t, { type: 'sine', freq: 110, freqEnd: 70, dur: 0.4, gain: 0.15 }),
  ),

  // Flow
  waveStart: (ac, out, t) => longest(
    tone(ac, out, t, { type: 'sawtooth', freq: 196, dur: 0.22, gain: 0.05, attack: 0.02 }),
    tone(ac, out, t, { type: 'sawtooth', freq: 294, dur: 0.38, gain: 0.05, attack: 0.02, at: 0.2 }),
    tone(ac, out, t, { type: 'sine', freq: 98, dur: 0.55, gain: 0.08, attack: 0.02 }),
  ),
  bossWarn: (ac, out, t) => {
    let end = 0;
    for (let i = 0; i < 3; i++) {
      end = tone(ac, out, t, { type: 'triangle', freq: 420, freqEnd: 760, dur: 0.38, gain: 0.07, attack: 0.03, at: i * 0.42 });
    }
    return end;
  },
  waveClear: (ac, out, t) => longest(
    ...[523, 659, 784, 1047].map((f, i) => tone(ac, out, t, { type: 'triangle', freq: f, dur: 0.3, gain: 0.07, at: i * 0.08 })),
  ),
  gameOver: (ac, out, t) => longest(
    tone(ac, out, t, { type: 'sawtooth', freq: 440, freqEnd: 70, dur: 1.6, gain: 0.08, attack: 0.02 }),
    tone(ac, out, t, { type: 'sawtooth', freq: 466, freqEnd: 74, dur: 1.6, gain: 0.06, attack: 0.02 }),
    noise(ac, out, t, { filter: 'lowpass', freq: 600, freqEnd: 80, dur: 1.6, gain: 0.1 }),
  ),

  // UI
  place: (ac, out, t) => longest(
    tone(ac, out, t, { type: 'sine', freq: 200, freqEnd: 80, dur: 0.14, gain: 0.18 }),
    noise(ac, out, t, { filter: 'bandpass', freq: 2200, dur: 0.04, gain: 0.07 }),
  ),
  upgrade: (ac, out, t) => longest(
    ...[440, 554, 659, 880].map((f, i) => tone(ac, out, t, { type: 'triangle', freq: f, dur: 0.12, gain: 0.06, at: i * 0.05 })),
  ),
  specialize: (ac, out, t) => longest(
    tone(ac, out, t, { type: 'sawtooth', freq: 160, freqEnd: 900, dur: 0.35, gain: 0.05, attack: 0.05 }),
    ...[659, 880, 1319].map((f, i) => tone(ac, out, t, { type: 'triangle', freq: f, dur: 0.22, gain: 0.06, at: 0.3 + i * 0.07 })),
  ),
  sell: (ac, out, t) => longest(
    tone(ac, out, t, { type: 'triangle', freq: 1320, dur: 0.08, gain: 0.06 }),
    tone(ac, out, t, { type: 'triangle', freq: 990, dur: 0.14, gain: 0.06, at: 0.07 }),
  ),
  error: (ac, out, t) => longest(
    tone(ac, out, t, { type: 'square', freq: 150, dur: 0.08, gain: 0.05 }),
    tone(ac, out, t, { type: 'square', freq: 120, dur: 0.1, gain: 0.05, at: 0.1 }),
  ),
};

// Per-sound loudness (balanced from offline peak measurements: frequent sounds sit lower,
// alerts higher) and minimum spacing, so rapid fire from many towers stays a texture
// instead of a wall of noise (repeats inside the gap are simply dropped)
const MIX: Record<SoundName, { gain: number; minGapMs: number }> = {
  vulcan: { gain: 1.7, minGapMs: 55 }, vulcanHeavy: { gain: 2.5, minGapMs: 70 },
  railgun: { gain: 2.0, minGapMs: 70 }, railgunHyper: { gain: 2.7, minGapMs: 120 },
  mortar: { gain: 1.35, minGapMs: 90 }, cryoLaunch: { gain: 1.6, minGapMs: 90 },
  explosion: { gain: 1.35, minGapMs: 80 }, freeze: { gain: 1.2, minGapMs: 90 },
  death: { gain: 2.1, minGapMs: 40 }, deathBoss: { gain: 1.1, minGapMs: 300 },
  leak: { gain: 1.6, minGapMs: 250 },
  waveStart: { gain: 3.1, minGapMs: 500 }, bossWarn: { gain: 3.7, minGapMs: 1500 },
  waveClear: { gain: 3.1, minGapMs: 500 }, gameOver: { gain: 2.7, minGapMs: 2000 },
  place: { gain: 1.5, minGapMs: 60 }, upgrade: { gain: 4.0, minGapMs: 80 },
  specialize: { gain: 4.4, minGapMs: 200 }, sell: { gain: 3.6, minGapMs: 80 }, error: { gain: 4.0, minGapMs: 150 },
};

const MAX_VOICES = 28;
const MASTER_LEVEL = 0.5;
const MUTE_KEY = 'tdv.muted';

// Render one sound into any context (used by the live engine and by offline previews)
export const renderSound = (ac: BaseAudioContext, out: AudioNode, name: SoundName, t: number, pan = 0) => {
  const g = ac.createGain();
  g.gain.value = MIX[name].gain;
  let node: AudioNode = g;
  if (pan !== 0 && 'createStereoPanner' in ac) {
    const p = ac.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p);
    node = p;
  }
  node.connect(out);
  return VOICES[name](ac, g, t);
};

// Master bus: level + a fast, hard compressor acting as a limiter so dense fights don't clip.
// Shared by the live engine and offline renders so measurements match what players hear.
export const createMasterBus = (ac: BaseAudioContext, level = MASTER_LEVEL) => {
  const limiter = ac.createDynamicsCompressor();
  limiter.threshold.value = -20;
  limiter.knee.value = 6;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.12;
  const gain = ac.createGain();
  gain.gain.value = level;
  gain.connect(limiter).connect(ac.destination);
  return gain;
};

// ── Live engine ───────────────────────────────────────────────────────────

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let activeVoices = 0;
const lastPlayed = new Map<SoundName, number>();
let muted = (() => {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
})();

const ensureContext = () => {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  master = createMasterBus(ctx, muted ? 0 : MASTER_LEVEL);
  return ctx;
};

// Browsers only allow audio after a user gesture: call this from input handlers
export const unlockAudio = () => {
  const ac = ensureContext();
  if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
};

export const isMuted = () => muted;

export const setMuted = (m: boolean) => {
  muted = m;
  try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* storage unavailable */ }
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : MASTER_LEVEL, ctx.currentTime, 0.03);
};

// Fire-and-forget; `pan` is -1 (left) … 1 (right)
export const playSound = (name: SoundName, pan = 0) => {
  if (muted || !ctx || !master || ctx.state !== 'running') return;
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? -Infinity) < MIX[name].minGapMs) return;
  if (activeVoices >= MAX_VOICES) return;
  lastPlayed.set(name, now);
  activeVoices++;
  const dur = renderSound(ctx, master, name, ctx.currentTime + 0.005, pan);
  window.setTimeout(() => { activeVoices--; }, (dur + 0.05) * 1000);
};
