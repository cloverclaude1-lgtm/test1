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
    createScene('Blue Atmosphere', {
      front: { intensity: 0.2, color: { r: 0.15, g: 0.35, b: 1 }, movement: 'slow', strobe: 0 },
      back: { intensity: 0.4, color: { r: 0.1, g: 0.25, b: 0.9 }, movement: 'slow', strobe: 0 },
      center: { intensity: 0.25, color: { r: 0.2, g: 0.4, b: 1 }, movement: 'static', strobe: 0 },
    }, {}, { type: 'fade', duration: 3 }),

    createScene('Warm Verse', {
      front: { intensity: 0.35, color: { r: 1, g: 0.65, b: 0.35 }, movement: 'slow', strobe: 0 },
      back: { intensity: 0.3, color: { r: 0.9, g: 0.4, b: 0.2 }, movement: 'static', strobe: 0 },
      center: { intensity: 0.3, color: { r: 1, g: 0.7, b: 0.4 }, movement: 'slow', strobe: 0 },
    }, { bassPulseGroups: ['front'], bassPulseAmount: 0.3 }, { type: 'fade', duration: 2.5 }),

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

    createScene('Chorus Bloom', {
      front: { intensity: 0.75, color: { r: 1, g: 0.2, b: 0.6 }, movement: 'medium', strobe: 0 },
      back: { intensity: 0.7, color: { r: 0.3, g: 0.6, b: 1 }, movement: 'medium', strobe: 0 },
      center: { intensity: 0.7, color: { r: 1, g: 0.4, b: 0.8 }, movement: 'medium', strobe: 0 },
    }, { beatFlashGroups: ['par'], beatFlashAmount: 0.5, bassPulseGroups: ['back'], bassPulseAmount: 0.4 },
      { type: 'crossfade', duration: 1.5 }),

    // Slow left-right pan sweep + every fixture dimming/brightening in unison,
    // like the whole rig is breathing. spread: 0 on the pulse keeps it synchronized.
    createScene('Breathing', {
      front: { intensity: 0.45, color: { r: 0.3, g: 0.4, b: 0.95 }, movement: 'slow', strobe: 0, pulse: { rate: 0.12, depth: 0.55, spread: 0 } },
      back: { intensity: 0.4, color: { r: 0.35, g: 0.3, b: 0.9 }, movement: 'slow', strobe: 0, pulse: { rate: 0.12, depth: 0.5, spread: 0 } },
      center: { intensity: 0.4, color: { r: 0.35, g: 0.35, b: 0.95 }, movement: 'slow', strobe: 0, pulse: { rate: 0.12, depth: 0.5, spread: 0 } },
    }, { bassPulseGroups: ['front'], bassPulseAmount: 0.2 }, { type: 'fade', duration: 3.5 }),

    // A quicker, punchier pulse — like a pulse/thump rather than a slow breath.
    createScene('Heartbeat', {
      front: { intensity: 0.5, color: { r: 0.95, g: 0.15, b: 0.2 }, movement: 'static', strobe: 0, pulse: { rate: 1.2, depth: 0.65, spread: 0 } },
      back: { intensity: 0.4, color: { r: 0.7, g: 0.1, b: 0.15 }, movement: 'static', strobe: 0, pulse: { rate: 1.2, depth: 0.55, spread: 0 } },
      center: { intensity: 0.45, color: { r: 1, g: 0.2, b: 0.25 }, movement: 'static', strobe: 0, pulse: { rate: 1.2, depth: 0.6, spread: 0 } },
    }, { beatFlashGroups: ['par', 'movinghead'], beatFlashAmount: 0.4, bassPulseGroups: ['front'], bassPulseAmount: 0.3 },
      { type: 'fade', duration: 1.5 }),

    // Same pulse mechanic as Breathing, but `spread > 0` staggers each fixture's
    // phase so the dim/bright pulse visibly travels across the rig left-to-right.
    createScene('Ocean Wave', {
      front: { intensity: 0.5, color: { r: 0.15, g: 0.55, b: 0.65 }, movement: 'slow', strobe: 0, pulse: { rate: 0.18, depth: 0.6, spread: 0.9 } },
      back: { intensity: 0.45, color: { r: 0.1, g: 0.45, b: 0.6 }, movement: 'slow', strobe: 0, pulse: { rate: 0.18, depth: 0.55, spread: 0.9 } },
      center: { intensity: 0.5, color: { r: 0.15, g: 0.6, b: 0.7 }, movement: 'slow', strobe: 0, pulse: { rate: 0.18, depth: 0.6, spread: 0.9 } },
      left: { intensity: 0.45, color: { r: 0.1, g: 0.5, b: 0.65 }, movement: 'slow', strobe: 0, pulse: { rate: 0.18, depth: 0.55, spread: 0.9 } },
      right: { intensity: 0.45, color: { r: 0.15, g: 0.55, b: 0.65 }, movement: 'slow', strobe: 0, pulse: { rate: 0.18, depth: 0.55, spread: 0.9 } },
    }, {}, { type: 'crossfade', duration: 3 }),

    // colorCycle with spread > 0 gives each fixture a different instantaneous hue
    // while they all keep cycling — a rainbow that visibly moves across the rig.
    createScene('Rainbow Chase', {
      front: { intensity: 0.7, color: { r: 1, g: 1, b: 1 }, movement: 'medium', strobe: 0, colorCycle: { rate: 0.15, spread: 1.2 } },
      back: { intensity: 0.6, color: { r: 1, g: 1, b: 1 }, movement: 'medium', strobe: 0, colorCycle: { rate: 0.15, spread: 1.2 } },
      center: { intensity: 0.65, color: { r: 1, g: 1, b: 1 }, movement: 'fast', strobe: 0, colorCycle: { rate: 0.15, spread: 1.2 } },
    }, { beatFlashGroups: ['par', 'movinghead'], beatFlashAmount: 0.4 }, { type: 'crossfade', duration: 1.5 }),

    // colorCycle with spread 0 — every fixture holds the exact same hue and fades
    // through colors together, slowly, with no movement or strobe. Very mellow.
    createScene('Slow Fade', {
      front: { intensity: 0.4, color: { r: 1, g: 1, b: 1 }, movement: 'static', strobe: 0, colorCycle: { rate: 0.03, saturation: 0.6, lightness: 0.5, spread: 0 } },
      back: { intensity: 0.35, color: { r: 1, g: 1, b: 1 }, movement: 'static', strobe: 0, colorCycle: { rate: 0.03, saturation: 0.6, lightness: 0.5, spread: 0 } },
      center: { intensity: 0.35, color: { r: 1, g: 1, b: 1 }, movement: 'static', strobe: 0, colorCycle: { rate: 0.03, saturation: 0.6, lightness: 0.5, spread: 0 } },
    }, {}, { type: 'fade', duration: 4 }),

    // Big, fast, saturated — every fixture cycling color independently at full tilt.
    createScene('Full Rainbow', {
      front: { intensity: 0.9, color: { r: 1, g: 1, b: 1 }, movement: 'fast', strobe: 0.1, colorCycle: { rate: 0.3, spread: 1.5 } },
      back: { intensity: 0.85, color: { r: 1, g: 1, b: 1 }, movement: 'fast', strobe: 0.1, colorCycle: { rate: 0.3, spread: 1.5 } },
      center: { intensity: 0.9, color: { r: 1, g: 1, b: 1 }, movement: 'chaos', strobe: 0.15, colorCycle: { rate: 0.3, spread: 1.5 } },
    }, { beatFlashGroups: ['par', 'movinghead', 'strobe'], beatFlashAmount: 0.7, bassPulseGroups: ['front', 'back'], bassPulseAmount: 0.6 },
      { type: 'crossfade', duration: 1 }),

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

    // Warm, static, atmospheric — a daylight-fading complement to Blue Atmosphere.
    createScene('Sunset Glow', {
      front: { intensity: 0.4, color: { r: 1, g: 0.5, b: 0.25 }, movement: 'slow', strobe: 0 },
      back: { intensity: 0.35, color: { r: 0.9, g: 0.25, b: 0.45 }, movement: 'static', strobe: 0 },
      center: { intensity: 0.35, color: { r: 1, g: 0.55, b: 0.3 }, movement: 'slow', strobe: 0 },
    }, { bassPulseGroups: ['back'], bassPulseAmount: 0.25 }, { type: 'fade', duration: 4 }),

    // Cool white/blue fast sweeping movement, low color variety — reads as
    // searchlights scanning the crowd/venue.
    createScene('Spotlight Search', {
      front: { intensity: 0.55, color: { r: 0.75, g: 0.85, b: 1 }, movement: 'fast', strobe: 0 },
      back: { intensity: 0.3, color: { r: 0.6, g: 0.7, b: 0.9 }, movement: 'chaos', strobe: 0 },
      center: { intensity: 0.5, color: { r: 0.85, g: 0.9, b: 1 }, movement: 'fast', strobe: 0 },
    }, {}, { type: 'fade', duration: 2 }),

    // Very low, soft, pastel — background ambience for a quiet moment.
    createScene('Chill Wash', {
      front: { intensity: 0.15, color: { r: 0.4, g: 0.55, b: 0.6 }, movement: 'static', strobe: 0 },
      back: { intensity: 0.18, color: { r: 0.45, g: 0.4, b: 0.6 }, movement: 'static', strobe: 0 },
      center: { intensity: 0.15, color: { r: 0.5, g: 0.5, b: 0.65 }, movement: 'static', strobe: 0 },
    }, {}, { type: 'fade', duration: 5 }),
  ];
}
