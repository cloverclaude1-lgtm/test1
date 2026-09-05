// Generates a short synthetic EDM-style demo track (public/demo-song.wav) purely
// with additive/synthesized signals (no external assets), so the app has
// something to analyze/play out of the box and so BPM/beat detection can be
// exercised deterministically during development. Not meant to sound like a
// real record — just to have clear kicks, a bass line, hats, and a
// quiet -> build -> drop -> verse -> chorus -> outro energy arc.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SR = 44100;
const BPM = 128;
const SEC_PER_BEAT = 60 / BPM;
const SEC_PER_BAR = SEC_PER_BEAT * 4;

const SECTIONS = [
  { name: 'intro', bars: 3, level: 0.16, kickPattern: 'downbeat', hats: false, bass: false },
  { name: 'buildup', bars: 3, level: 0.4, kickPattern: 'four', hats: true, bass: false, riser: true },
  { name: 'drop', bars: 5, level: 0.95, kickPattern: 'four', hats: true, bass: true, snare: true },
  { name: 'verse', bars: 3, level: 0.42, kickPattern: 'half', hats: false, bass: true },
  { name: 'chorus', bars: 4, level: 0.85, kickPattern: 'four', hats: true, bass: true, snare: true },
  { name: 'outro', bars: 2, level: 0.14, kickPattern: 'downbeat', hats: false, bass: false },
];

const totalBars = SECTIONS.reduce((a, s) => a + s.bars, 0);
const duration = totalBars * SEC_PER_BAR + 0.5;
const numSamples = Math.ceil(duration * SR);
const out = new Float32Array(numSamples);

function addAt(startSec, fn, lenSec) {
  const start = Math.floor(startSec * SR);
  const len = Math.floor(lenSec * SR);
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx >= 0 && idx < out.length) out[idx] += fn(i / SR);
  }
}

function kick(t, amp) {
  const freq = 140 * Math.exp(-t / 0.035) + 42;
  const env = Math.exp(-t / 0.09);
  return Math.sin(2 * Math.PI * freq * t) * env * amp;
}

function hat(t, amp) {
  const env = Math.exp(-t / 0.035);
  return (Math.random() * 2 - 1) * env * amp * 0.5;
}

function snare(t, amp) {
  const env = Math.exp(-t / 0.12);
  const tone = Math.sin(2 * Math.PI * 190 * t) * 0.4;
  return ((Math.random() * 2 - 1) * 0.7 + tone) * env * amp;
}

function bassNote(t, freq, amp) {
  const env = Math.min(1, t / 0.01) * Math.exp(-t / 1.4);
  return (Math.sin(2 * Math.PI * freq * t) + 0.4 * Math.sin(2 * Math.PI * freq * 2 * t)) * env * amp * 0.5;
}

function pad(t, amp) {
  const chord = [220, 277, 330];
  let s = 0;
  for (const f of chord) s += Math.sin(2 * Math.PI * f * t + f * 0.001);
  return (s / chord.length) * amp * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.1 * t));
}

let cursor = 0;
const bassFreqs = [55, 55, 73.4, 55]; // A1, A1, D2, A1 — simple root/fourth movement per bar
let barIndex = 0;

for (const section of SECTIONS) {
  for (let bar = 0; bar < section.bars; bar++) {
    const barStart = cursor;

    // Pad bed under quiet sections
    if (!section.bass) addAt(barStart, (t) => pad(t, section.level * 0.5), SEC_PER_BAR);

    // Kick pattern
    for (let beat = 0; beat < 4; beat++) {
      const beatTime = barStart + beat * SEC_PER_BEAT;
      let hit = false;
      if (section.kickPattern === 'four') hit = true;
      else if (section.kickPattern === 'half') hit = beat % 2 === 0;
      else if (section.kickPattern === 'downbeat') hit = beat === 0;
      if (hit) addAt(beatTime, (t) => kick(t, section.level), 0.15);

      if (section.hats) {
        addAt(beatTime + SEC_PER_BEAT / 2, (t) => hat(t, section.level * 0.6), 0.05);
        addAt(beatTime, (t) => hat(t, section.level * 0.25), 0.04);
      }
      if (section.snare && beat === 2) addAt(beatTime, (t) => snare(t, section.level * 0.7), 0.15);
    }

    if (section.bass) {
      addAt(barStart, (t) => bassNote(t, bassFreqs[barIndex % bassFreqs.length], section.level), SEC_PER_BAR);
    }

    if (section.riser) {
      const p = bar / section.bars;
      addAt(barStart, (t) => hat(t, section.level * 0.15 * (0.3 + p)), SEC_PER_BAR);
    }

    cursor += SEC_PER_BAR;
    barIndex++;
  }
}

// Soft overall limiter/normalize
let peak = 0;
for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
const norm = peak > 0 ? 0.85 / peak : 1;

const int16 = new Int16Array(out.length);
for (let i = 0; i < out.length; i++) {
  int16[i] = Math.max(-32768, Math.min(32767, Math.round(out[i] * norm * 32767)));
}

// --- Minimal WAV writer (16-bit PCM mono) ---
function writeWav(int16Data, sampleRate) {
  const blockAlign = 2;
  const dataSize = int16Data.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * blockAlign, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < int16Data.length; i++) buffer.writeInt16LE(int16Data[i], 44 + i * 2);
  return buffer;
}

const wav = writeWav(int16, SR);
const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'demo-song.wav');
writeFileSync(outPath, wav);
console.log(`Wrote ${outPath} (${duration.toFixed(1)}s, ${(wav.length / 1024).toFixed(0)} KB)`);
