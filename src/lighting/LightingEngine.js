import { createDefaultFixtureState, cloneFixtureState, lerpFixtureState, applyOverride } from './FixtureState.js';
import { findActiveCue } from './ShowGenerator.js';
import { fixtureMatchesGroup } from './Groups.js';
import { evaluateRule } from './RuleEngine.js';

// ---------------------------------------------------------------------------
// LightingEngine — the heart of the app (brief §8).
//
//   Audio features + Musical events + Current scene + User rules + Fixtures
//                                   |
//                                   v
//                             FixtureState per fixture
//
// This module has ZERO knowledge of Three.js or the DOM: `update()` is a pure
// function of (time, features, events, project-state) -> Map<fixtureId,
// FixtureState>. That is what keeps the renderer swappable and is the seam a
// future DMX/Art-Net output would also plug into (brief §24).
//
// Layering per fixture, each pass allowed to override the previous:
//   1. Scene base look (per-group intensity/color + procedural movement)
//   2. Scene audio reactions (beat flash decay, bass pulse, onset sparkle)
//   3. User rules (continuous conditions + timed effects: flash/fade/pulse)
//   4. Per-fixture manual override (brief §20 — never destructive)
// ---------------------------------------------------------------------------

const MOVEMENT_SPEED = { static: 0, slow: 0.06, medium: 0.15, fast: 0.35, chaos: 0 };

function hash01(n) {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

function computeMovement(mode, time, phase, bass) {
  if (mode === 'chaos') {
    const bucket = Math.floor(time / 0.28) + phase * 13.7;
    const pan = (hash01(bucket) * 2 - 1) * 0.95;
    const tilt = (hash01(bucket + 91.3) * 2 - 1) * 0.8;
    return { pan, tilt };
  }
  const freq = MOVEMENT_SPEED[mode] ?? 0.1;
  if (freq === 0) {
    return { pan: Math.sin(phase) * 0.15, tilt: Math.cos(phase) * 0.08 };
  }
  const amp = 0.5 + (mode === 'fast' ? bass * 0.2 : 0);
  const pan = Math.sin(time * freq * 2 * Math.PI + phase) * (0.35 + amp * 0.5);
  const tilt = Math.sin(time * freq * 1.3 * 2 * Math.PI + phase * 1.7) * (0.25 + amp * 0.3);
  return { pan, tilt };
}

const FALLBACK_GROUP_CFG = { intensity: 0.3, color: { r: 1, g: 1, b: 1 }, movement: 'static', strobe: 0 };
const FALLBACK_REACTIONS = { beatFlashGroups: [], beatFlashAmount: 0, bassPulseGroups: [], bassPulseAmount: 0, onsetSparkleGroups: [] };

/** Picks the scene-group config that applies to a fixture's role, falling back sensibly. */
function groupConfigFor(scene, fixture) {
  const groups = scene?.groups || {};
  return (
    groups[fixture.role] ||
    groups[fixture.type] ||
    groups.center ||
    Object.values(groups)[0] || FALLBACK_GROUP_CFG
  );
}

export class LightingEngine {
  constructor() {
    this._lastTime = 0;
    this.flashEnvelope = new Map(); // fixtureId -> { value, decayTo }
    this.ruleWasActive = new Map(); // ruleId -> bool (edge detection)
    this.timedEffects = []; // { ruleId, group, kind, amount/target, startTime, duration }
    this.fadeState = new Map(); // ruleId -> { from, to, startTime, duration }
    this.manualSceneOverride = null; // { sceneId } | null
  }

  resetClock(time) {
    this._lastTime = time;
    this.flashEnvelope.clear();
    this.timedEffects.length = 0;
    this.fadeState.clear();
  }

  clearSceneOverride() {
    this.manualSceneOverride = null;
  }

  /**
   * @param {number} time - current playback time (s)
   * @param {import('../audio/FeatureStream.js').FeatureStream} featureStream
   * @param {Object} project - { fixtures, customGroups, timeline, scenes, rules }
   * @returns {Map<string, FixtureState>}
   */
  update(time, featureStream, project) {
    const dt = Math.max(0, Math.min(0.25, time - this._lastTime));
    this._lastTime = time;

    const features = featureStream ? featureStream.sample(time) : { bass: 0, mid: 0, treble: 0, energy: 0, spectralCentroid: 0, bpm: 120 };
    const eventsThisFrame = featureStream ? featureStream.eventsInRange(time - dt, time) : [];
    const sectionLabel = featureStream?.sectionAt(time)?.label || null;

    const { active, prev } = findActiveCue(project.timeline, time);
    let sceneNow = active ? project.scenes[active.sceneId] : null;
    let blend = 1;
    let scenePrev = null;

    if (this.manualSceneOverride && project.scenes[this.manualSceneOverride.sceneId]) {
      sceneNow = project.scenes[this.manualSceneOverride.sceneId];
      blend = 1;
    } else if (active && active.transitionType !== 'instant' && prev) {
      blend = Math.min(1, (time - active.startTime) / Math.max(0.01, active.transitionDuration));
      scenePrev = project.scenes[prev.sceneId] || null;
    }

    const beatEvent = eventsThisFrame.find((e) => e.type === 'KICK');
    const onsetEvent = eventsThisFrame.find((e) => e.type === 'ONSET');

    const ctx = { features, eventsThisFrame, sectionLabel };
    const result = new Map();

    project.fixtures.forEach((fixture, i) => {
      if (!sceneNow) {
        // No show generated yet — a faint idle wash so the rig is still visible on stage.
        const idle = createDefaultFixtureState();
        idle.intensity = 0.15;
        idle.color = { r: 0.5, g: 0.55, b: 0.8 };
        result.set(fixture.id, applyOverride(idle, fixture.override));
        return;
      }

      const cfgNow = groupConfigFor(sceneNow, fixture);
      const cfgPrev = scenePrev ? groupConfigFor(scenePrev, fixture) : cfgNow;

      const phase = i * 1.618; // golden-angle-ish stagger so fixtures don't move in lockstep

      const moveNow = computeMovement(cfgNow.movement, time, phase, features.bass);
      const moveBlend = scenePrev ? computeMovement(cfgPrev.movement, time, phase, features.bass) : moveNow;

      let state = createDefaultFixtureState();
      state.intensity = lerp(cfgPrev.intensity, cfgNow.intensity, blend);
      state.color = {
        r: lerp(cfgPrev.color.r, cfgNow.color.r, blend),
        g: lerp(cfgPrev.color.g, cfgNow.color.g, blend),
        b: lerp(cfgPrev.color.b, cfgNow.color.b, blend),
      };
      state.pan = lerp(moveBlend.pan, moveNow.pan, blend);
      state.tilt = lerp(moveBlend.tilt, moveNow.tilt, blend);
      state.strobe = lerp(cfgPrev.strobe, cfgNow.strobe, blend);
      state.zoom = 0.5;

      // --- Scene audio reactions -------------------------------------------------
      const reactions = { ...FALLBACK_REACTIONS, ...(sceneNow.reactions || {}) };
      if (beatEvent && (reactions.beatFlashGroups || []).some((g) => fixtureMatchesGroup(fixture, g, project.customGroups))) {
        this.flashEnvelope.set(fixture.id, { value: (reactions.beatFlashAmount ?? 0) * beatEvent.strength, tau: 0.18 });
      }
      const env = this.flashEnvelope.get(fixture.id);
      if (env) {
        state.intensity = Math.min(1, state.intensity + env.value);
        state.color = { r: lerp(state.color.r, 1, env.value * 0.6), g: lerp(state.color.g, 1, env.value * 0.6), b: lerp(state.color.b, 1, env.value * 0.6) };
        env.value *= Math.exp(-dt / env.tau);
        if (env.value < 0.01) this.flashEnvelope.delete(fixture.id);
      }

      if ((reactions.bassPulseGroups || []).some((g) => fixtureMatchesGroup(fixture, g, project.customGroups))) {
        state.intensity = Math.min(1, state.intensity + features.bass * (reactions.bassPulseAmount ?? 0) * 0.6);
      }

      if (fixture.type === 'ledstrip') {
        state.pixels = computeLedPixels(fixture, time, features, onsetEvent);
      }

      // --- User rules --------------------------------------------------------------
      this._applyRules(project.rules || [], fixture, state, ctx, time, project.customGroups);

      // --- Per-fixture frequency-band reactivity (optional, set on the fixture) -----
      const reactivity = fixture.audioReactivity;
      if (reactivity && reactivity.band && reactivity.band !== 'none') {
        const bandValue = features[reactivity.band] ?? 0;
        if (reactivity.mode === 'modulate') {
          state.intensity *= bandValue;
        } else if (bandValue < (reactivity.threshold ?? 0.5)) {
          state.intensity = 0;
        }
      }

      // --- Manual override (never destroyed by automation, brief §20) --------------
      state = applyOverride(state, fixture.override);
      if (fixture.enabled === false) state.intensity = 0;

      result.set(fixture.id, state);
    });

    return result;
  }

  _applyRules(rules, fixture, state, ctx, time, customGroups) {
    for (const rule of rules) {
      const isActive = evaluateRule(rule, ctx);
      const wasActive = this.ruleWasActive.get(rule.id) || false;
      const risingEdge = isActive && !wasActive;
      this.ruleWasActive.set(rule.id, isActive);

      for (const action of rule.actions || []) {
        const matches = action.group ? fixtureMatchesGroup(fixture, action.group, customGroups) : false;

        switch (action.type) {
          case 'setBrightness':
            if (matches && isActive) state.intensity = action.value ?? state.intensity;
            break;
          case 'changeColor':
            if (matches && isActive) state.color = { ...state.color, ...action.color };
            break;
          case 'move':
            if (matches && isActive) {
              if (action.pan != null) state.pan = action.pan;
              if (action.tilt != null) state.tilt = action.tilt;
            }
            break;
          case 'strobe':
            if (matches && isActive) state.strobe = action.rate ?? 1;
            break;
          case 'setGroupEnabled':
            if (matches && isActive && action.enabled === false) state.intensity = 0;
            break;
          case 'pulse':
            if (matches && isActive) {
              const rate = action.rateHz ?? 2;
              const amt = action.amount ?? 0.4;
              state.intensity = Math.min(1, Math.max(0, state.intensity + Math.sin(time * rate * 2 * Math.PI) * amt));
            }
            break;
          case 'flash':
            if (matches && risingEdge) {
              this.timedEffects.push({ fixtureScope: action.group, kind: 'flash', amount: action.amount ?? 0.9, startTime: time, duration: (action.durationMs ?? 150) / 1000, customGroups });
            }
            break;
          case 'fade':
            if (matches && risingEdge) {
              this.fadeState.set(rule.id + ':' + fixture.id, { from: state.intensity, to: action.value ?? 1, startTime: time, duration: action.durationSec ?? 1 });
            }
            break;
          case 'changeScene':
            if (risingEdge && action.sceneId) this.manualSceneOverride = { sceneId: action.sceneId };
            break;
          default:
            break;
        }
      }
    }

    // Apply + garbage-collect timed flash effects that target this fixture.
    this.timedEffects = this.timedEffects.filter((fx) => {
      const elapsed = time - fx.startTime;
      if (elapsed > fx.duration) return false;
      if (fixtureMatchesGroup(fixture, fx.fixtureScope, fx.customGroups)) {
        const k = 1 - elapsed / fx.duration;
        state.intensity = Math.min(1, state.intensity + fx.amount * k);
      }
      return true;
    });

    const fadeKey = [...this.fadeState.keys()].find((k) => k.endsWith(':' + fixture.id));
    if (fadeKey) {
      const f = this.fadeState.get(fadeKey);
      const t = Math.min(1, (time - f.startTime) / Math.max(0.01, f.duration));
      state.intensity = lerp(f.from, f.to, easeInOut(t));
      if (t >= 1) this.fadeState.delete(fadeKey);
    }
  }
}

function computeLedPixels(fixture, time, features, onsetEvent) {
  const count = fixture.params?.pixelCount || 12;
  const pixels = new Array(count);
  const chaseSpeed = 0.6 + features.treble * 2;
  for (let p = 0; p < count; p++) {
    const wave = 0.5 + 0.5 * Math.sin(time * chaseSpeed * 2 * Math.PI - p * 0.5);
    let v = wave * (0.3 + features.mid * 0.7);
    if (onsetEvent) v = Math.min(1, v + onsetEvent.strength * hash01(p * 7.13 + Math.floor(time * 10)));
    pixels[p] = Math.max(0, Math.min(1, v));
  }
  return pixels;
}

function lerp(a, b, t) { return a + (b - a) * t; }
function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
