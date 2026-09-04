// ---------------------------------------------------------------------------
// Scene data model
//
// A Scene is a reusable lighting "look" (brief §15): a target state per
// fixture group, plus a `reactions` config describing how that look responds
// to live audio events (beat/bass/onset). The Scene itself never touches a
// specific fixture id — LightingEngine resolves each group to fixtures at
// runtime, so scenes stay valid as the rig changes.
// ---------------------------------------------------------------------------

let nextSceneId = 1;
export function makeSceneId() {
  return `scene_${Date.now().toString(36)}_${(nextSceneId++).toString(36)}`;
}

/**
 * @param {string} name
 * @param {Object} groups - map of groupName -> { intensity, color:{r,g,b}, movement, strobe,
 *   pulse?: { rate, depth, spread }, colorCycle?: { rate, saturation, lightness, spread } }
 *   `pulse` breathes intensity up/down over time (spread 0 = every fixture in the group
 *   pulses together, spread > 0 = the pulse sweeps across fixtures like a wave).
 *   `colorCycle` rotates hue over time instead of holding a static `color` (spread > 0
 *   spreads that hue across fixtures instead of keeping them in sync — a rainbow spread
 *   vs. one color fading together). Both are independent of the music — see
 *   LightingEngine.update()'s "Scene-driven animation" pass.
 * @param {Object} [reactions]
 * @param {Object} [transition]
 */
export function createScene(name, groups, reactions = {}, transition = {}) {
  return {
    id: makeSceneId(),
    name,
    groups,
    reactions: {
      beatFlashGroups: reactions.beatFlashGroups || [],
      beatFlashAmount: reactions.beatFlashAmount ?? 0.6,
      bassPulseGroups: reactions.bassPulseGroups || [],
      bassPulseAmount: reactions.bassPulseAmount ?? 0.5,
      onsetSparkleGroups: reactions.onsetSparkleGroups || [],
    },
    transition: {
      type: transition.type || 'fade', // 'instant' | 'fade' | 'crossfade'
      duration: transition.duration ?? 2.0,
      easing: transition.easing || 'easeInOut',
    },
  };
}

/** A handful of ready-made scenes users can apply manually (brief §15 examples). */
export function builtinSceneLibrary() {
  return [
    createScene('Drop', {
      front: { intensity: 1, color: { r: 1, g: 1, b: 1 }, movement: 'chaos', strobe: 0.3 },
      back: { intensity: 1, color: { r: 0.4, g: 0.8, b: 1 }, movement: 'chaos', strobe: 0.2 },
      center: { intensity: 1, color: { r: 1, g: 1, b: 1 }, movement: 'fast', strobe: 0.4 },
      strobe: { intensity: 0.8, color: { r: 1, g: 1, b: 1 }, movement: 'static', strobe: 0.7 },
    }, {
      beatFlashGroups: ['movinghead', 'par', 'strobe'],
      beatFlashAmount: 0.9,
      bassPulseGroups: ['front', 'back'],
      bassPulseAmount: 0.8,
    }, { type: 'instant', duration: 0.15 }),

    // Full-tilt strobe across everything — a "go nuts" look you can apply by hand
    // without needing a beat to trigger it.
    createScene('Strobe Storm', {
      front: { intensity: 1, color: { r: 1, g: 1, b: 1 }, movement: 'chaos', strobe: 0.9 },
      back: { intensity: 1, color: { r: 0.8, g: 0.85, b: 1 }, movement: 'chaos', strobe: 0.85 },
      center: { intensity: 1, color: { r: 1, g: 1, b: 1 }, movement: 'fast', strobe: 0.95 },
      strobe: { intensity: 1, color: { r: 1, g: 1, b: 1 }, movement: 'static', strobe: 1 },
    }, { beatFlashGroups: ['movinghead', 'par'], beatFlashAmount: 0.5, bassPulseGroups: ['front', 'back'], bassPulseAmount: 0.5 },
      { type: 'instant', duration: 0.1 }),

    // Mostly dark, punctuated by hard flashes — tension/anticipation rather than
    // constant brightness.
    createScene('Blackout Pulse', {
      front: { intensity: 0.05, color: { r: 1, g: 1, b: 1 }, movement: 'static', strobe: 0 },
      back: { intensity: 0.05, color: { r: 0.6, g: 0.2, b: 0.8 }, movement: 'static', strobe: 0 },
      center: { intensity: 0.05, color: { r: 1, g: 1, b: 1 }, movement: 'static', strobe: 0 },
    }, { beatFlashGroups: ['movinghead', 'par', 'strobe'], beatFlashAmount: 1, bassPulseGroups: ['front'], bassPulseAmount: 0.3 },
      { type: 'instant', duration: 0.1 }),

    // Cool white/blue sweeping movement, dark baseline like Blackout Pulse —
    // reads as searchlights that strike bright on every beat, dark between.
    createScene('Spotlight Search', {
      front: { intensity: 0.05, color: { r: 0.75, g: 0.85, b: 1 }, movement: 'fast', strobe: 0 },
      back: { intensity: 0.04, color: { r: 0.6, g: 0.7, b: 0.9 }, movement: 'chaos', strobe: 0 },
      center: { intensity: 0.05, color: { r: 0.85, g: 0.9, b: 1 }, movement: 'fast', strobe: 0 },
    }, { beatFlashGroups: ['front', 'back', 'center', 'movinghead', 'par'], beatFlashAmount: 1, bassPulseGroups: ['front'], bassPulseAmount: 0.3 },
      { type: 'instant', duration: 0.1 }),

    // Everything dark except center, which strikes bright on the beat — one
    // performer picked out of the dark, pulsing rather than held constant.
    createScene('Center Spotlight', {
      front: { intensity: 0.04, color: { r: 0.7, g: 0.75, b: 0.85 }, movement: 'static', strobe: 0 },
      back: { intensity: 0.03, color: { r: 0.6, g: 0.65, b: 0.8 }, movement: 'static', strobe: 0 },
      center: { intensity: 0.05, color: { r: 0.9, g: 0.92, b: 1 }, movement: 'slow', strobe: 0 },
    }, { beatFlashGroups: ['center', 'movinghead'], beatFlashAmount: 1, bassPulseGroups: ['center'], bassPulseAmount: 0.3 },
      { type: 'instant', duration: 0.1 }),

    // Calmer and wider than Spotlight Search — the whole sweep (front/left/
    // right/center) strikes together on the beat, dark baseline between.
    createScene('Audience Sweep', {
      front: { intensity: 0.05, color: { r: 0.8, g: 0.88, b: 1 }, movement: 'medium', strobe: 0 },
      back: { intensity: 0.04, color: { r: 0.7, g: 0.78, b: 0.95 }, movement: 'medium', strobe: 0 },
      center: { intensity: 0.04, color: { r: 0.8, g: 0.85, b: 1 }, movement: 'medium', strobe: 0 },
      left: { intensity: 0.05, color: { r: 0.75, g: 0.85, b: 1 }, movement: 'medium', strobe: 0 },
      right: { intensity: 0.05, color: { r: 0.75, g: 0.85, b: 1 }, movement: 'medium', strobe: 0 },
    }, { beatFlashGroups: ['front', 'left', 'right', 'center', 'movinghead', 'par'], beatFlashAmount: 1, bassPulseGroups: ['front'], bassPulseAmount: 0.3 },
      { type: 'instant', duration: 0.1 }),

    // One dominant beam that snaps to a new spot on `chaos` movement and
    // strikes bright on the beat — hunting and striking, dark between hits.
    createScene('Roaming Spot', {
      front: { intensity: 0.03, color: { r: 0.7, g: 0.75, b: 0.85 }, movement: 'static', strobe: 0 },
      back: { intensity: 0.03, color: { r: 0.6, g: 0.65, b: 0.8 }, movement: 'static', strobe: 0 },
      center: { intensity: 0.05, color: { r: 0.85, g: 0.9, b: 1 }, movement: 'chaos', strobe: 0 },
    }, { beatFlashGroups: ['center', 'movinghead'], beatFlashAmount: 1, bassPulseGroups: ['center'], bassPulseAmount: 0.3 },
      { type: 'instant', duration: 0.1 }),
  ];
}
