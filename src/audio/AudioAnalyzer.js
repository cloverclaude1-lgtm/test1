import { magnitudeSpectrum } from './fft.js';

// ---------------------------------------------------------------------------
// AudioAnalyzer
//
// Performs a one-time OFFLINE pass over a decoded AudioBuffer and produces a
// fully pre-computed timeline of continuous audio features + discrete
// musical events. Because the whole song is known in advance, this gives far
// better sync accuracy than reacting to audio in real time (see brief §6/§21):
// beat grids, section boundaries and BPM are exact against the recorded
// waveform rather than guessed frame-by-frame during playback.
//
// The result of `analyze()` is a plain-data AnalysisResult object consumed by
// FeatureStream (src/audio/FeatureStream.js) during playback, and by
// ShowGenerator (src/lighting/ShowGenerator.js) to build the automatic show.
// ---------------------------------------------------------------------------

const FFT_SIZE = 2048; // ~46ms window @44.1kHz — good tradeoff of freq/time resolution
const HOP_SIZE = 1024; // 50% overlap
const COARSE_BUCKET_SECONDS = 2; // resolution used for structural section detection

function mixToMono(buffer) {
  const ch = buffer.numberOfChannels;
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < ch; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) out[i] += data[i] / ch;
  }
  return out;
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = Math.min(sortedArr.length - 1, Math.floor(p * sortedArr.length));
  return sortedArr[idx];
}

function normalizeArray(arr) {
  const sorted = Float32Array.from(arr).sort();
  const ref = percentile(sorted, 0.95) || 1e-6;
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = Math.min(1, arr[i] / ref);
  return out;
}

/**
 * Classic adaptive-threshold peak picker used for both bass-beat detection
 * and spectral-flux onset detection ("Beat Detection Algorithms", Patin).
 * Keeps a short rolling history of the envelope and fires whenever the
 * current value spikes above `sensitivity * localAverage`, with a variance
 * derived sensitivity so it self-tunes to how "spiky" the signal is.
 */
function pickPeaks(envelope, frameHopSeconds, { historySeconds = 1.0, minIntervalSeconds = 0.25 } = {}) {
  const historyLen = Math.max(4, Math.round(historySeconds / frameHopSeconds));
  const peaks = [];
  let lastPeakTime = -Infinity;

  for (let i = 0; i < envelope.length; i++) {
    const start = Math.max(0, i - historyLen);
    const window = envelope.subarray(start, i + 1);
    if (window.length < 4) continue;

    let mean = 0;
    for (let j = 0; j < window.length; j++) mean += window[j];
    mean /= window.length;

    let variance = 0;
    for (let j = 0; j < window.length; j++) variance += (window[j] - mean) ** 2;
    variance /= window.length;

    // Higher variance (dynamic material) -> lower multiplier needed to trigger;
    // very steady material needs a higher multiplier to avoid false positives.
    let sensitivity = -0.0025714 * variance * 1e4 + 1.5142857;
    sensitivity = Math.max(1.05, Math.min(1.7, sensitivity));

    const time = i * frameHopSeconds;
    if (envelope[i] > mean * sensitivity && envelope[i] > 0.02 && time - lastPeakTime >= minIntervalSeconds) {
      const strength = Math.max(0, Math.min(1, (envelope[i] - mean) / (mean + 1e-6) / 2));
      peaks.push({ time, strength: Math.max(0.15, strength) });
      lastPeakTime = time;
    }
  }
  return peaks;
}

/** Derive a single BPM estimate from beat timestamps via interval histogram. */
function estimateBPM(beatTimes) {
  const intervals = [];
  for (let i = 1; i < beatTimes.length; i++) {
    const dt = beatTimes[i] - beatTimes[i - 1];
    if (dt >= 60 / 200 && dt <= 60 / 50) intervals.push(dt);
  }
  if (intervals.length < 4) return 120;

  const buckets = new Map();
  for (const dt of intervals) {
    const bpm = Math.round(60 / dt);
    buckets.set(bpm, (buckets.get(bpm) || 0) + 1);
  }
  // Fold octave errors (half/double tempo) into whichever bucket is already
  // strongest, since 90 and 180 BPM look identical to a beat-interval count.
  let best = 120;
  let bestScore = -1;
  for (const [bpm, count] of buckets) {
    let score = count;
    score += (buckets.get(bpm * 2) || 0) * 0.5;
    score += (buckets.get(Math.round(bpm / 2)) || 0) * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = bpm;
    }
  }
  return best;
}

/**
 * Segments the song into coarse structural sections (intro/buildup/drop/
 * verse/chorus/outro) from a smoothed energy curve. This is a heuristic, not
 * true music-structure analysis (see README limitations) — it is deliberately
 * simple so it stays fast, deterministic and easy to reason about.
 */
function detectSections(coarseEnergy, bucketSeconds, duration) {
  if (coarseEnergy.length === 0) return [];

  // Light smoothing so we react to sustained level changes, not single bars.
  const smoothed = new Float32Array(coarseEnergy.length);
  for (let i = 0; i < coarseEnergy.length; i++) {
    const a = coarseEnergy[Math.max(0, i - 1)];
    const b = coarseEnergy[i];
    const c = coarseEnergy[Math.min(coarseEnergy.length - 1, i + 1)];
    smoothed[i] = (a + b + c) / 3;
  }

  const band = (v) => (v < 0.35 ? 'low' : v > 0.65 ? 'high' : 'mid');
  const minBuckets = Math.max(3, Math.round(8 / bucketSeconds)); // min ~8s per section

  const rawSections = [];
  let curBand = band(smoothed[0]);
  let curStart = 0;
  for (let i = 1; i < smoothed.length; i++) {
    const b = band(smoothed[i]);
    if (b !== curBand && i - curStart >= minBuckets) {
      rawSections.push({ startBucket: curStart, endBucket: i, band: curBand });
      curStart = i;
      curBand = b;
    }
  }
  rawSections.push({ startBucket: curStart, endBucket: smoothed.length, band: curBand });

  // Label sections using position + energy trend relative to neighbours.
  const sections = rawSections.map((s, i) => {
    const start = s.startBucket * bucketSeconds;
    const end = Math.min(duration, s.endBucket * bucketSeconds);
    const avgEnergy =
      smoothed.slice(s.startBucket, s.endBucket).reduce((a, b) => a + b, 0) /
      Math.max(1, s.endBucket - s.startBucket);

    const trendStart = smoothed[s.startBucket];
    const trendEnd = smoothed[Math.max(s.startBucket, s.endBucket - 1)];
    const isRamping = trendEnd - trendStart > 0.15;
    const next = rawSections[i + 1];

    let label;
    if (i === 0 && s.band !== 'high') label = 'intro';
    else if (i === rawSections.length - 1 && s.band !== 'high') label = 'outro';
    else if (s.band === 'high' && isRamping === false && next && next.band !== 'high') label = 'drop';
    else if (isRamping && next && next.band === 'high') label = 'buildup';
    else if (s.band === 'high') label = 'chorus';
    else label = 'verse';

    return { start, end, label, energy: avgEnergy };
  });

  return sections;
}

export class AudioAnalyzer {
  /**
   * @param {AudioBuffer} audioBuffer
   * @param {(progress:number, stage:string)=>void} [onProgress]
   * @returns {Promise<AnalysisResult>}
   */
  static async analyze(audioBuffer, onProgress = () => {}) {
    const sampleRate = audioBuffer.sampleRate;
    const mono = mixToMono(audioBuffer);
    const duration = audioBuffer.duration;
    const numFrames = Math.max(1, Math.floor((mono.length - FFT_SIZE) / HOP_SIZE));
    const frameHopSeconds = HOP_SIZE / sampleRate;

    const rms = new Float32Array(numFrames);
    const bassRaw = new Float32Array(numFrames);
    const midRaw = new Float32Array(numFrames);
    const trebleRaw = new Float32Array(numFrames);
    const centroidRaw = new Float32Array(numFrames);
    const flux = new Float32Array(numFrames);

    const nyquist = sampleRate / 2;
    const binHz = nyquist / (FFT_SIZE / 2);
    const bassMax = Math.min(FFT_SIZE / 2, Math.round(250 / binHz));
    const midMax = Math.min(FFT_SIZE / 2, Math.round(4000 / binHz));
    const trebleMax = Math.min(FFT_SIZE / 2, Math.round(12000 / binHz));

    let prevMag = null;
    const frame = new Float32Array(FFT_SIZE);

    onProgress(0, 'decode');

    // Process in chunks, yielding to the event loop between them so the
    // onboarding checklist can animate and the tab stays responsive on long songs.
    const CHUNK = 200;
    for (let i = 0; i < numFrames; i++) {
      const offset = i * HOP_SIZE;
      frame.set(mono.subarray(offset, offset + FFT_SIZE));

      let sumSq = 0;
      for (let s = 0; s < FFT_SIZE; s++) sumSq += frame[s] * frame[s];
      rms[i] = Math.sqrt(sumSq / FFT_SIZE);

      const mags = magnitudeSpectrum(frame, FFT_SIZE);

      let bassSum = 0, midSum = 0, trebleSum = 0;
      let weightedFreq = 0, magSum = 0;
      for (let k = 0; k < mags.length; k++) {
        const m = mags[k];
        if (k < bassMax) bassSum += m;
        else if (k < midMax) midSum += m;
        else if (k < trebleMax) trebleSum += m;
        weightedFreq += m * (k * binHz);
        magSum += m;
      }
      bassRaw[i] = bassSum;
      midRaw[i] = midSum;
      trebleRaw[i] = trebleSum;
      centroidRaw[i] = magSum > 1e-6 ? weightedFreq / magSum : 0;

      if (prevMag) {
        let f = 0;
        for (let k = 0; k < mags.length; k++) f += Math.max(0, mags[k] - prevMag[k]);
        flux[i] = f;
      }
      prevMag = mags;

      if (i % CHUNK === 0) {
        onProgress(i / numFrames, 'freq');
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    const bass = normalizeArray(bassRaw);
    const mid = normalizeArray(midRaw);
    const treble = normalizeArray(trebleRaw);
    const energy = normalizeArray(rms);
    const centroidNorm = new Float32Array(numFrames);
    for (let i = 0; i < numFrames; i++) centroidNorm[i] = Math.min(1, centroidRaw[i] / 6000);

    // Beats: adaptive peaks on the bass envelope (kick/beat-driven material).
    const beats = pickPeaks(bassRaw, frameHopSeconds, { historySeconds: 1.0, minIntervalSeconds: 60 / 220 });
    // Onsets: adaptive peaks on broadband spectral flux (any instrument attack).
    const onsets = pickPeaks(flux, frameHopSeconds, { historySeconds: 0.5, minIntervalSeconds: 0.08 });

    const bpm = estimateBPM(beats.map((b) => b.time));

    onProgress(0.75, 'beats');
    await new Promise((r) => setTimeout(r, 0));

    // Coarse energy curve for structure detection.
    const bucketFrames = Math.max(1, Math.round(COARSE_BUCKET_SECONDS / frameHopSeconds));
    const numBuckets = Math.ceil(numFrames / bucketFrames);
    const coarseEnergy = new Float32Array(numBuckets);
    for (let b = 0; b < numBuckets; b++) {
      let sum = 0, count = 0;
      for (let i = b * bucketFrames; i < Math.min(numFrames, (b + 1) * bucketFrames); i++) {
        sum += energy[i];
        count++;
      }
      coarseEnergy[b] = count ? sum / count : 0;
    }
    const sections = detectSections(coarseEnergy, COARSE_BUCKET_SECONDS, duration);
    onProgress(0.9, 'sections');

    // Discrete events timeline: KICK, ONSET, ENERGY_UP/DOWN, SILENCE, SECTION_CHANGE
    const events = [];
    for (const b of beats) events.push({ type: 'KICK', timestamp: b.time, strength: b.strength });
    for (const o of onsets) events.push({ type: 'ONSET', timestamp: o.time, strength: o.strength });
    for (const s of sections) events.push({ type: 'SECTION_CHANGE', timestamp: s.start, strength: 1, label: s.label });

    for (let b = 1; b < coarseEnergy.length; b++) {
      const delta = coarseEnergy[b] - coarseEnergy[b - 1];
      const t = b * COARSE_BUCKET_SECONDS;
      if (delta > 0.22) events.push({ type: 'ENERGY_UP', timestamp: t, strength: Math.min(1, delta * 2) });
      else if (delta < -0.22) events.push({ type: 'ENERGY_DOWN', timestamp: t, strength: Math.min(1, -delta * 2) });
      if (coarseEnergy[b] < 0.04) events.push({ type: 'SILENCE', timestamp: t, strength: 1 });
    }
    events.sort((a, b) => a.timestamp - b.timestamp);

    onProgress(1, 'done');

    return {
      duration,
      sampleRate,
      frameHopSeconds,
      numFrames,
      bpm,
      beats,
      onsets,
      sections,
      events,
      frames: {
        bass, mid, treble, energy,
        centroid: centroidNorm,
      },
    };
  }
}
