// Minimal iterative radix-2 Cooley-Tukey FFT.
// Used offline by AudioAnalyzer to turn short windows of PCM into a spectrum.
// `size` must be a power of two.

const twiddleCache = new Map();

function getTwiddles(size) {
  let t = twiddleCache.get(size);
  if (t) return t;
  const half = size / 2;
  const cos = new Float32Array(half);
  const sin = new Float32Array(half);
  for (let i = 0; i < half; i++) {
    const angle = (-2 * Math.PI * i) / size;
    cos[i] = Math.cos(angle);
    sin[i] = Math.sin(angle);
  }
  t = { cos, sin };
  twiddleCache.set(size, t);
  return t;
}

/**
 * In-place FFT. `re`/`im` are Float32Arrays of length `size` (power of two).
 */
export function fft(re, im) {
  const n = re.length;

  // bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len;
    const { cos, sin } = getTwiddles(n);
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const tIdx = k * step;
        const wr = cos[tIdx];
        const wi = sin[tIdx];
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + half] * wr - im[i + k + half] * wi;
        const bIm = re[i + k + half] * wi + im[i + k + half] * wr;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + half] = aRe - bRe;
        im[i + k + half] = aIm - bIm;
      }
    }
  }
}

/** Hann window, cached per size. */
const hannCache = new Map();
export function hannWindow(size) {
  let w = hannCache.get(size);
  if (w) return w;
  w = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  }
  hannCache.set(size, w);
  return w;
}

/**
 * Computes magnitude spectrum (length size/2) of a windowed real signal.
 * `frame` should already be `size` samples long.
 */
export function magnitudeSpectrum(frame, size) {
  const window = hannWindow(size);
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  for (let i = 0; i < size; i++) re[i] = frame[i] * window[i];
  fft(re, im);
  const half = size / 2;
  const mags = new Float32Array(half);
  for (let i = 0; i < half; i++) {
    mags[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  }
  return mags;
}
