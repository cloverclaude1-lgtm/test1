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
 * @param {Object} groups - map of groupName -> { intensity, color:{r,g,b}, movement, strobe }
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
  ];
}
