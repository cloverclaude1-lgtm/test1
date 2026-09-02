import { AudioAnalyzer } from './AudioAnalyzer.js';
import { FeatureStream } from './FeatureStream.js';

// ---------------------------------------------------------------------------
// AudioEngine
//
// Owns audio decoding + playback (Web Audio API) and drives the offline
// AudioAnalyzer once per imported song. This is the only module that talks
// to the browser's audio APIs — everything downstream (lighting, UI) reads
// through FeatureStream / this class's transport getters.
// ---------------------------------------------------------------------------

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffer = null;
    this.sourceNode = null;
    this.gainNode = null;
    this.fileName = '';
    this.audioDataUrl = null; // retained so the project can be saved standalone

    this.featureStream = null;
    this.analysis = null;

    this._isPlaying = false;
    this._startedAtCtxTime = 0; // ctx.currentTime when playback started
    this._startedAtOffset = 0; // song-time offset at that moment

    this.onAnalysisProgress = null; // (progress, stage) => void
    this.onEnded = null;
  }

  _ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.gainNode = this.ctx.createGain();
      this.gainNode.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  /**
   * Loads a song from a File/Blob (or an existing data URL when restoring a
   * project), decodes it, and runs the offline analysis pass.
   */
  async loadFromFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    const dataUrl = await blobToDataUrl(file);
    this.fileName = file.name || 'song';
    return this._loadFromArrayBuffer(arrayBuffer, dataUrl);
  }

  async loadFromDataUrl(dataUrl, fileName = 'song') {
    const arrayBuffer = await (await fetch(dataUrl)).arrayBuffer();
    this.fileName = fileName;
    return this._loadFromArrayBuffer(arrayBuffer, dataUrl);
  }

  /** Restores a previously-analyzed song from a saved project — skips re-running AudioAnalyzer. */
  async restoreFromProject(dataUrl, fileName, analysis) {
    this.stop();
    const ctx = this._ensureContext();
    this.audioDataUrl = dataUrl;
    this.fileName = fileName;
    const arrayBuffer = await (await fetch(dataUrl)).arrayBuffer();
    this.buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    this.analysis = analysis;
    this.featureStream = new FeatureStream(analysis);
    return analysis;
  }

  async _loadFromArrayBuffer(arrayBuffer, dataUrl) {
    this.stop();
    const ctx = this._ensureContext();
    this.audioDataUrl = dataUrl;
    this.buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));

    this.analysis = await AudioAnalyzer.analyze(this.buffer, (p, stage) => {
      this.onAnalysisProgress?.(p, stage);
    });
    this.featureStream = new FeatureStream(this.analysis);
    return this.analysis;
  }

  get duration() {
    return this.buffer ? this.buffer.duration : 0;
  }

  get isPlaying() {
    return this._isPlaying;
  }

  /** Current playback position in seconds. */
  get currentTime() {
    if (!this._isPlaying) return this._startedAtOffset;
    return this._startedAtOffset + (this.ctx.currentTime - this._startedAtCtxTime);
  }

  play() {
    if (!this.buffer || this._isPlaying) return;
    const ctx = this._ensureContext();
    if (ctx.state === 'suspended') ctx.resume();

    const offset = Math.min(this._startedAtOffset, this.buffer.duration);
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.gainNode);
    src.onended = () => {
      if (this.sourceNode === src) {
        this._isPlaying = false;
        this.onEnded?.();
      }
    };
    src.start(0, offset);
    this.sourceNode = src;
    this._startedAtCtxTime = ctx.currentTime;
    this._startedAtOffset = offset;
    this._isPlaying = true;
  }

  pause() {
    if (!this._isPlaying) return;
    this._startedAtOffset = this.currentTime;
    this._isPlaying = false;
    this._stopSource();
  }

  stop() {
    this._startedAtOffset = 0;
    this._isPlaying = false;
    this._stopSource();
    this.featureStream?.resetCursor(0);
  }

  seek(time) {
    const wasPlaying = this._isPlaying;
    this._stopSource();
    this._startedAtOffset = Math.max(0, Math.min(time, this.duration));
    this.featureStream?.resetCursor(this._startedAtOffset);
    this._isPlaying = false;
    if (wasPlaying) this.play();
  }

  _stopSource() {
    if (this.sourceNode) {
      try {
        this.sourceNode.onended = null;
        this.sourceNode.stop();
      } catch (e) { /* already stopped */ }
      this.sourceNode = null;
    }
  }

  setVolume(v) {
    if (this.gainNode) this.gainNode.gain.value = v;
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
