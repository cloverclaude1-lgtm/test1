// ---------------------------------------------------------------------------
// FeatureStream
//
// Wraps a pre-computed AnalysisResult (see AudioAnalyzer) and exposes the
// audio-feature interface described in the build brief (§7):
//
//   audio.bass / audio.mid / audio.treble / audio.energy
//   audio.spectralCentroid / audio.bpm
//   audio.beat / audio.beatStrength / audio.onset
//
// The LightingEngine and RuleEngine only ever talk to this interface, never
// to the analyzer internals. That indirection is what will let a future
// live-microphone input source implement the same interface (bass/mid/
// treble/energy/beat/...) computed frame-by-frame in real time, without any
// change to lighting logic (see brief §7/§24).
// ---------------------------------------------------------------------------

export class FeatureStream {
  constructor(analysis) {
    this.analysis = analysis;
    this._lastEventCursor = 0; // index into analysis.events, advances monotonically with playback time
    this._lastTime = 0;
  }

  /** Continuous features at an arbitrary playback time (0..duration). */
  sample(time) {
    const a = this.analysis;
    if (!a) return emptyFeatures();
    const idx = Math.max(0, Math.min(a.numFrames - 1, Math.round(time / a.frameHopSeconds)));
    return {
      bass: a.frames.bass[idx] || 0,
      mid: a.frames.mid[idx] || 0,
      treble: a.frames.treble[idx] || 0,
      energy: a.frames.energy[idx] || 0,
      spectralCentroid: a.frames.centroid[idx] || 0,
      bpm: a.bpm,
    };
  }

  /** Section (intro/buildup/drop/verse/chorus/outro) active at `time`, or null. */
  sectionAt(time) {
    const a = this.analysis;
    if (!a) return null;
    for (const s of a.sections) {
      if (time >= s.start && time < s.end) return s;
    }
    return a.sections[a.sections.length - 1] || null;
  }

  /**
   * Returns discrete events whose timestamp falls within (fromTime, toTime].
   * Used once per render frame with a small forward-looking window so beat
   * flashes, onsets etc. fire exactly once each, in playback order, even
   * after a seek (call `resetCursor` on seek).
   */
  eventsInRange(fromTime, toTime) {
    const a = this.analysis;
    if (!a || !a.events.length) return [];
    if (toTime < fromTime) return []; // seeking backwards handled by caller via resetCursor

    // Cursor only ever moves forward across sequential calls, so this stays O(1) amortized.
    while (this._lastEventCursor > 0 && a.events[this._lastEventCursor - 1]?.timestamp > fromTime) {
      this._lastEventCursor--;
    }
    const out = [];
    let i = this._lastEventCursor;
    while (i < a.events.length && a.events[i].timestamp <= toTime) {
      if (a.events[i].timestamp > fromTime) out.push(a.events[i]);
      i++;
    }
    this._lastEventCursor = i;
    return out;
  }

  /** Call after a seek/scrub so eventsInRange re-syncs to the new position. */
  resetCursor(time) {
    const a = this.analysis;
    this._lastEventCursor = 0;
    if (a) {
      while (this._lastEventCursor < a.events.length && a.events[this._lastEventCursor].timestamp <= time) {
        this._lastEventCursor++;
      }
    }
  }

  get bpm() {
    return this.analysis?.bpm ?? 120;
  }
}

function emptyFeatures() {
  return { bass: 0, mid: 0, treble: 0, energy: 0, spectralCentroid: 0, bpm: 120 };
}
