"""Builds the game's sound effects from CC0 source recordings.

    python3 tools/audio/build_sfx.py <sources_dir> public/audio

<sources_dir> comes from tools/audio/fetch_sources.sh. Each game sound is designed here from one
or more recordings: sliced, layered, re-pitched, filtered and given a clean tail, in several
variants so repeats never sound identical. Output: mono MP3s plus manifest.json (read by
src/lib/audio.ts) and CREDITS.md. Needs numpy and ffmpeg.
"""
import json
import math
import os
import subprocess
import sys
import tempfile

import numpy as np

SR = 44100
SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)


# ── I/O ─────────────────────────────────────────────────────────────────────
def load(rel):
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', os.path.join(SRC, rel), '-ac', '1', '-ar', str(SR),
                          '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def kenney(pack, name):
    return load(f'kenney_{pack}/Audio/{name}.ogg')


def write_mp3(x, path, bitrate='96k'):
    with tempfile.NamedTemporaryFile(suffix='.f32') as tmp:
        tmp.write(x.astype(np.float32).tobytes())
        tmp.flush()
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', tmp.name,
                        '-c:a', 'libmp3lame', '-b:a', bitrate, path], check=True)


# ── DSP ─────────────────────────────────────────────────────────────────────
def onset(x, db=-30):
    """Index of the first sample within `db` of the peak."""
    return int(np.argmax(np.abs(x) > np.max(np.abs(x)) * 10 ** (db / 20)))


def cut(x, start=0.0, dur=None, from_onset=True, pre=0.002):
    i = (onset(x) - int(pre * SR) if from_onset else 0) + int(start * SR)
    i = max(0, i)
    return x[i:] if dur is None else x[i:i + int(dur * SR)]


def pitch(x, ratio):
    """Resample: ratio > 1 raises pitch (and shortens), like speeding up tape."""
    n = int(len(x) / ratio)
    return np.interp(np.arange(n) * ratio, np.arange(len(x)), x)


def sweep(x, start, end):
    """Tape-style pitch glide from `start` to `end` playback rate over the clip."""
    rates = np.linspace(start, end, len(x))
    pos = np.cumsum(rates)
    pos = pos[pos < len(x) - 1]
    return np.interp(pos, np.arange(len(x)), x)


def biquad(x, kind, freq, q=0.707):
    """RBJ cookbook low/high/band-pass."""
    w = 2 * math.pi * freq / SR
    a = math.sin(w) / (2 * q)
    c = math.cos(w)
    if kind == 'lp':
        b = [(1 - c) / 2, 1 - c, (1 - c) / 2]
    elif kind == 'hp':
        b = [(1 + c) / 2, -(1 + c), (1 + c) / 2]
    else:  # band-pass, 0 dB peak
        b = [a, 0, -a]
    a0, a1, a2 = 1 + a, -2 * c, 1 - a
    b0, b1, b2 = (v / a0 for v in b)
    a1, a2 = a1 / a0, a2 / a0
    y = np.zeros_like(x)
    x1 = x2 = y1 = y2 = 0.0
    for i, xi in enumerate(x):
        yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, xi, y1, yi
        y[i] = yi
    return y


def fade(x, fade_in=0.002, fade_out=0.05):
    x = x.copy()
    i, o = int(fade_in * SR), min(len(x), int(fade_out * SR))
    if i:
        x[:i] *= np.linspace(0, 1, i)
    if o:
        x[-o:] *= np.linspace(1, 0, o) ** 2
    return x


def decay(x, seconds):
    """Exponential envelope reaching -60 dB after `seconds` — tightens long tails."""
    t = np.arange(len(x)) / SR
    return x * np.exp(-6.9 * t / seconds)


def saturate(x, drive=1.5):
    return np.tanh(x * drive) / np.tanh(drive)


def mix(*layers, length=None):
    """layers: (signal, gain_db, offset_seconds)"""
    end = max(int(off * SR) + len(sig) for sig, _, off in layers)
    out = np.zeros(length and int(length * SR) or end)
    for sig, gain_db, off in layers:
        i = int(off * SR)
        sig = fade(sig, 0.0005, 0.008)  # a layer cut mid-sound would otherwise end in a click
        seg = sig[:max(0, len(out) - i)] * 10 ** (gain_db / 20)
        out[i:i + len(seg)] += seg
    return out


def finish(x, peak_db=-1.0, tail=0.04):
    x = fade(x, 0.001, tail)
    return x / (np.max(np.abs(x)) + 1e-9) * 10 ** (peak_db / 20)


def seamless_loop(x, seconds, xfade=1.0):
    """A loop of `seconds` whose end crossfades into its start."""
    n, f = int(seconds * SR), int(xfade * SR)
    body = x[:n + f].copy()
    ramp = np.linspace(0, 1, f)
    body[:f] = body[:f] * ramp + body[n:n + f] * (1 - ramp)
    return body[:n]


# ── Sound designs ───────────────────────────────────────────────────────────
GUN = 'oga-gunshots'


def shots(name):
    """Split a recording of separate gunshots into individual shots."""
    x = load(f'{GUN}/{name}.wav')
    env = np.abs(x)
    hop = int(0.005 * SR)
    frames = np.array([env[i:i + hop].max() for i in range(0, len(x) - hop, hop)])
    thr = frames.max() * 0.35
    starts, last = [], -999
    for i in range(1, len(frames)):
        if frames[i] > thr >= frames[i - 1] and i - last > 30:
            starts.append(i * hop)
            last = i
    return [x[max(0, s - int(0.002 * SR)):] for s in starts]


def designs():
    pistol, magnum, powder = shots('22 Pistol'), shots('22 Magnum'), shots('Black Powder')
    S = {}

    # Rapid Vulcan: tight, bright rotary-cannon shots; a faint, very short action click
    # (longer or louder, the click's ring took over and the shot read as a bell)
    S['vulcan'] = [finish(saturate(mix(
        (biquad(decay(pitch(s, 1.12)[:int(0.18 * SR)], 0.2), 'hp', 120), 0, 0),
        (fade(kenney('impact-sounds', f'impactMetal_light_00{k}')[:int(0.03 * SR)], 0.001, 0.02), -22, 0.002),
    ), 2.2)) for k, s in enumerate(pistol[:5])]

    # Titan Vulcan: heavier calibre, lower and longer, with a punch underneath
    S['vulcanHeavy'] = [finish(saturate(mix(
        (biquad(decay(pitch(s, 0.86)[:int(0.3 * SR)], 0.24), 'hp', 70), 0, 0),
        (cut(kenney('impact-sounds', f'impactPunch_heavy_00{k}'), dur=0.2), -8, 0),
    ), 1.6)) for k, s in enumerate((magnum + powder)[:4])]

    # Railgun: electric discharge with a hard low-end kick
    S['railgun'] = [finish(mix(
        (cut(kenney('sci-fi-sounds', f'laserLarge_00{k}')), 0, 0),
        (decay(cut(kenney('sci-fi-sounds', 'impactMetal_001'), dur=0.25), 0.2), -6, 0),
        (biquad(cut(kenney('sci-fi-sounds', f'forceField_00{k + 2}'), dur=0.12), 'hp', 1500), -14, 0),
    )) for k in range(3)]

    # Hyper railgun: a rising charge, then a deep, long discharge
    S['railgunHyper'] = [finish(mix(
        (fade(sweep(cut(kenney('sci-fi-sounds', f'forceField_00{k}'), dur=0.5), 0.7, 1.6), 0.08, 0.03), -6, 0),
        (pitch(cut(kenney('sci-fi-sounds', f'laserLarge_00{k + 1}')), 0.78), 0, 0.22),
        (cut(kenney('sci-fi-sounds', 'lowFrequency_explosion_001')), -8, 0.22),
    )) for k in range(3)]

    # Mortar launch: a deep tube thump
    S['mortar'] = [finish(saturate(mix(
        (biquad(decay(pitch(s, 0.55)[:int(0.55 * SR)], 0.45), 'lp', 2200), 0, 0),
        (cut(kenney('impact-sounds', f'impactPunch_heavy_00{k}')), -6, 0),
    ), 1.4)) for k, s in enumerate(powder[:4])]

    # Cryo mortar: the same thump with an icy glass crackle
    S['cryoLaunch'] = [finish(saturate(mix(
        (biquad(decay(pitch(s, 0.6)[:int(0.45 * SR)], 0.35), 'lp', 1800), 0, 0),
        (cut(kenney('impact-sounds', f'impactGlass_light_00{k}')), -7, 0.03),
    ), 1.4)) for k, s in enumerate(powder[2:5])]

    # Shell explosions: crunchy blast over a low-frequency body
    S['explosion'] = [finish(mix(
        (decay(cut(kenney('sci-fi-sounds', f'explosionCrunch_00{k}')), 0.9), 0, 0),
        (decay(cut(kenney('sci-fi-sounds', f'lowFrequency_explosion_00{k % 2}')), 0.8), -5, 0),
    ), tail=0.15) for k in range(5)]

    # Cryo burst: shattering ice and a frosty shimmer
    S['freeze'] = [finish(mix(
        (cut(kenney('impact-sounds', f'impactGlass_heavy_00{k}')), 0, 0),
        (biquad(cut(kenney('sci-fi-sounds', f'forceField_00{k + 1}'), dur=0.35), 'hp', 2500), -10, 0.02),
        (cut(kenney('impact-sounds', f'impactGlass_light_00{k + 1}')), -6, 0.06),
    )) for k in range(4)]

    # Enemy destroyed: a small, sharp metallic pop (plays often, so it stays short)
    S['death'] = [finish(mix(
        (biquad(decay(cut(kenney('sci-fi-sounds', f'explosionCrunch_00{k}'), dur=0.35), 0.28), 'hp', 300), 0, 0),
        (cut(kenney('impact-sounds', f'impactMetal_heavy_00{k}')), -5, 0),
    )) for k in range(5)]

    # Dreadnought destroyed: a long, layered, rolling detonation
    S['deathBoss'] = [finish(mix(
        (cut(kenney('sci-fi-sounds', f'lowFrequency_explosion_00{k}')), 0, 0),
        (cut(kenney('sci-fi-sounds', 'explosionCrunch_004')), -3, 0),
        (cut(kenney('sci-fi-sounds', f'explosionCrunch_00{k + 1}')), -6, 0.35),
        (pitch(cut(kenney('sci-fi-sounds', 'explosionCrunch_003')), 0.7), -8, 0.7),
    ), tail=0.4) for k in range(2)]

    # Core breached: a heavy hit on the reactor and a power stutter
    S['leak'] = [finish(mix(
        (pitch(cut(kenney('impact-sounds', f'impactPlate_heavy_00{k}')), 0.6), 0, 0),
        (cut(kenney('sci-fi-sounds', 'forceField_001')), -6, 0.02),
        (cut(kenney('interface-sounds', f'glitch_00{k + 1}')), -4, 0.12),
        (cut(kenney('interface-sounds', f'glitch_00{k + 2}')), -4, 0.22),
    )) for k in range(2)]

    # Wave start: the gate's blast doors open over a rising engine rumble
    rumble = cut(kenney('sci-fi-sounds', 'spaceEngineLow_001'), dur=1.6, from_onset=False)
    S['waveStart'] = [finish(mix(
        (fade(rumble, 0.5, 0.6), -4, 0),
        (cut(kenney('sci-fi-sounds', f'doorOpen_00{k}')), 0, 0.35),
        (pitch(cut(kenney('impact-sounds', 'impactPlate_heavy_001')), 0.7), -6, 0.85),
    ), tail=0.3) for k in range(2)]

    # Boss warning: a two-tone klaxon (detuned saws through a formant band, saturated, three pulses)
    def klaxon():
        out = []
        for i in range(3):
            n = int(0.42 * SR)
            t = np.arange(n) / SR
            f = 420 + 340 * np.minimum(1, t / 0.3)
            phase = np.cumsum(f) / SR
            saw = sum(((phase * d) % 1.0) * 2 - 1 for d in (1.0, 1.007, 0.993)) / 3
            tone = biquad(saw, 'bp', 1100, 1.2) * 3 + biquad(saw, 'lp', 600) * 0.6
            out.append((fade(biquad(saturate(tone, 2.2), 'hp', 80), 0.02, 0.06), 0, i * 0.45))  # hp: no DC offset
        return finish(mix(*out), tail=0.1)
    S['bossWarn'] = [klaxon()]

    # Wave cleared: interface confirmation chime, doubled an octave up for sparkle
    S['waveClear'] = [finish(mix(
        (cut(kenney('interface-sounds', f'confirmation_00{k}')), 0, 0),
        (pitch(cut(kenney('interface-sounds', f'confirmation_00{k}')), 2.0), -9, 0.04),
    ), tail=0.1) for k in (1, 4)]

    # Defeat: the base powers down under a final deep blast
    S['gameOver'] = [finish(mix(
        (fade(sweep(cut(kenney('sci-fi-sounds', 'spaceEngine_001'), dur=3.0, from_onset=False), 1.0, 0.25), 0.05, 0.6), -2, 0),
        (cut(kenney('sci-fi-sounds', 'lowFrequency_explosion_000')), 0, 0),
        (pitch(cut(kenney('sci-fi-sounds', 'doorClose_001')), 0.6), -4, 0.3),
    ), tail=0.6)]

    # Tower placed: a heavy plate set down and bolted
    S['place'] = [finish(mix(
        (cut(kenney('impact-sounds', f'impactPlate_heavy_00{k}')), 0, 0),
        (pitch(cut(kenney('impact-sounds', f'impactMetal_heavy_00{k}')), 0.8), -4, 0),
        (cut(kenney('impact-sounds', f'impactMetal_light_00{k}')), -12, 0.09),
    )) for k in range(4)]

    # Upgrade: servo whir up and a confirming click
    S['upgrade'] = [finish(mix(
        (cut(kenney('interface-sounds', f'maximize_00{k}')), 0, 0),
        (cut(kenney('interface-sounds', f'switch_00{k + 1}')), -4, 0.16),
        (cut(kenney('impact-sounds', f'impactMetal_light_00{k}')), -10, 0.16),
    )) for k in (1, 2, 4)]

    # Specialization: a charging field, then a heavy lock-in
    S['specialize'] = [finish(mix(
        (fade(sweep(cut(kenney('sci-fi-sounds', f'forceField_00{k}')), 0.8, 1.3), 0.05, 0.1), -3, 0),
        (cut(kenney('interface-sounds', 'maximize_002')), -2, 0.28),
        (cut(kenney('impact-sounds', f'impactPlate_heavy_00{k + 1}')), -2, 0.5),
    ), tail=0.15) for k in (0, 3)]

    # Sold: the tower retracts, a hatch shuts
    S['sell'] = [finish(mix(
        (cut(kenney('sci-fi-sounds', f'doorClose_00{k}'), start=0.09), 0, 0),  # skip the slow swell: it answers a click
        (cut(kenney('impact-sounds', f'impactMetal_light_00{k + 1}')), -6, 0.3),
    )) for k in range(3)]

    # Not allowed
    S['error'] = [finish(cut(kenney('interface-sounds', f'error_00{k}'))) for k in (1, 3, 4)]

    # Background: a deep hangar/engine hum, low-passed, as a seamless 8 s loop
    hum = mix((kenney('sci-fi-sounds', 'spaceEngineLow_003'), 0, 0), (kenney('sci-fi-sounds', 'spaceEngineLow_000'), -2, 4.0))
    hum = biquad(biquad(hum, 'lp', 520), 'hp', 35)
    S['ambience'] = [seamless_loop(hum / np.max(np.abs(hum)) * 0.6, 8.0, 1.0)]
    return S


# Mix levels in the game (sample peaks are normalized; frequent sounds sit lower, alerts higher)
LEVELS = {
    'vulcan': (0.32, 0.06, 0.12), 'vulcanHeavy': (0.42, 0.05, 0.15), 'railgun': (0.5, 0.04, 0.25),
    'railgunHyper': (0.62, 0.03, 0.3), 'mortar': (0.55, 0.05, 0.2), 'cryoLaunch': (0.55, 0.05, 0.2),
    'explosion': (0.5, 0.06, 0.3), 'freeze': (0.45, 0.06, 0.3), 'death': (0.38, 0.08, 0.2),
    'deathBoss': (0.62, 0.02, 0.4), 'leak': (0.8, 0.0, 0.3), 'waveStart': (0.75, 0.0, 0.25),
    'bossWarn': (0.6, 0.0, 0.3), 'waveClear': (0.6, 0.0, 0.2), 'gameOver': (0.68, 0.0, 0.35),
    'place': (0.6, 0.04, 0.15), 'upgrade': (0.55, 0.02, 0.1), 'specialize': (0.65, 0.0, 0.2),
    'sell': (0.55, 0.03, 0.1), 'error': (0.5, 0.0, 0.0), 'ambience': (0.22, 0.0, 0.0),
}  # (gain, pitch spread, reverb send)

manifest = {}
for name, variants in designs().items():
    files = []
    for i, x in enumerate(variants):
        fname = f'{name}_{i}.mp3'
        write_mp3(x, os.path.join(OUT, fname), '128k' if name == 'ambience' else '96k')
        files.append(fname)
    gain, spread, reverb = LEVELS[name]
    manifest[name] = {'files': files, 'gain': gain, 'pitch': spread, 'reverb': reverb}
    print(f'{name:13} {len(files)} variant(s), {max(len(v) for v in variants) / SR:.2f}s')

with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
    json.dump(manifest, f, indent=1)
with open(os.path.join(OUT, 'CREDITS.md'), 'w') as f:
    f.write("""# Sound credits

The sound effects are built by `tools/audio/build_sfx.py` from these recordings, all released
under Creative Commons CC0 (public domain) — credit is not required, but given gladly:

- Sci-Fi Sounds, Impact Sounds, Interface Sounds — Kenney (www.kenney.nl)
- "Gunshots" — OpenGameArt.org (opengameart.org/content/gunshots)
""")
total = sum(os.path.getsize(os.path.join(OUT, n)) for n in os.listdir(OUT))
print(f'wrote {OUT}: {total // 1024} KB')
