import { createScene } from './scenes.js';

// ---------------------------------------------------------------------------
// Style presets (brief §10)
//
// Each style defines a color palette and a per-section "profile" (how bright,
// how fast the fixtures move, how much strobe, how hard it reacts to beat and
// bass) for each of the structural labels AudioAnalyzer can produce (intro,
// buildup, verse, chorus, drop, outro). ShowGenerator turns a detected
// section + a style into a concrete Scene by looking up this table — the
// mapping from "song structure" to "lighting mood" lives entirely here, so
// adding a new style is just adding a table row, never touching the generator
// algorithm itself.
// ---------------------------------------------------------------------------

function rgb(r, g, b) { return { r, g, b }; }

export const STYLES = {
  edm: {
    label: 'EDM',
    palette: [rgb(0.1, 0.9, 1), rgb(1, 0.15, 0.85), rgb(0.55, 0.2, 1), rgb(1, 1, 1), rgb(0.2, 1, 0.4)],
    sections: {
      intro:   { front: 0.25, back: 0.35, center: 0.2, movement: 'slow',   strobe: 0,    beatFlash: 0.3, bassPulse: 0.4, transition: ['fade', 2.5] },
      buildup: { front: 0.45, back: 0.5,  center: 0.4, movement: 'medium', strobe: 0.1,  beatFlash: 0.6, bassPulse: 0.6, transition: ['fade', 1.2] },
      verse:   { front: 0.4,  back: 0.4,  center: 0.35,movement: 'medium', strobe: 0,    beatFlash: 0.4, bassPulse: 0.5, transition: ['fade', 1.5] },
      chorus:  { front: 0.85, back: 0.8,  center: 0.8, movement: 'fast',   strobe: 0.15, beatFlash: 0.75,bassPulse: 0.75,transition: ['crossfade', 1] },
      drop:    { front: 1,    back: 1,    center: 1,   movement: 'chaos',  strobe: 0.5,  beatFlash: 0.95,bassPulse: 0.9, transition: ['instant', 0.15] },
      outro:   { front: 0.2,  back: 0.25, center: 0.2, movement: 'slow',   strobe: 0,    beatFlash: 0.2, bassPulse: 0.3, transition: ['fade', 3] },
    },
  },
  rock: {
    label: 'Rock',
    palette: [rgb(1, 1, 1), rgb(1, 0.15, 0.1), rgb(1, 0.6, 0.05), rgb(0.9, 0.9, 1)],
    sections: {
      intro:   { front: 0.3,  back: 0.3,  center: 0.25,movement: 'static', strobe: 0,    beatFlash: 0.4, bassPulse: 0.3, transition: ['fade', 2] },
      buildup: { front: 0.5,  back: 0.45, center: 0.45,movement: 'slow',   strobe: 0,    beatFlash: 0.6, bassPulse: 0.5, transition: ['fade', 1] },
      verse:   { front: 0.45, back: 0.35, center: 0.4, movement: 'static', strobe: 0,    beatFlash: 0.5, bassPulse: 0.4, transition: ['fade', 1.2] },
      chorus:  { front: 0.9,  back: 0.7,  center: 0.85,movement: 'medium', strobe: 0.1,  beatFlash: 0.85,bassPulse: 0.7, transition: ['crossfade', 0.8] },
      drop:    { front: 1,    back: 0.9,  center: 1,   movement: 'fast',   strobe: 0.35, beatFlash: 1,   bassPulse: 0.85,transition: ['instant', 0.1] },
      outro:   { front: 0.25, back: 0.2,  center: 0.2, movement: 'static', strobe: 0,    beatFlash: 0.3, bassPulse: 0.2, transition: ['fade', 2.5] },
    },
  },
  pop: {
    label: 'Pop',
    palette: [rgb(1, 0.3, 0.6), rgb(0.3, 0.7, 1), rgb(1, 0.85, 0.2), rgb(0.6, 0.3, 1), rgb(0.3, 1, 0.75)],
    sections: {
      intro:   { front: 0.3,  back: 0.35, center: 0.3, movement: 'slow',   strobe: 0,    beatFlash: 0.35,bassPulse: 0.35,transition: ['fade', 2] },
      buildup: { front: 0.5,  back: 0.5,  center: 0.45,movement: 'medium', strobe: 0,    beatFlash: 0.55,bassPulse: 0.5, transition: ['fade', 1] },
      verse:   { front: 0.4,  back: 0.4,  center: 0.4, movement: 'medium', strobe: 0,    beatFlash: 0.45,bassPulse: 0.45,transition: ['fade', 1.2] },
      chorus:  { front: 0.85, back: 0.75, center: 0.8, movement: 'fast',   strobe: 0.05, beatFlash: 0.7, bassPulse: 0.65,transition: ['crossfade', 1] },
      drop:    { front: 0.95, back: 0.85, center: 0.9, movement: 'fast',   strobe: 0.2,  beatFlash: 0.85,bassPulse: 0.75,transition: ['crossfade', 0.5] },
      outro:   { front: 0.25, back: 0.3,  center: 0.25,movement: 'slow',   strobe: 0,    beatFlash: 0.3, bassPulse: 0.3, transition: ['fade', 2.5] },
    },
  },
  chill: {
    label: 'Chill',
    palette: [rgb(0.2, 0.4, 0.9), rgb(0.3, 0.7, 0.7), rgb(0.5, 0.3, 0.8), rgb(0.15, 0.6, 0.55)],
    sections: {
      intro:   { front: 0.15, back: 0.25, center: 0.15,movement: 'static', strobe: 0, beatFlash: 0.1, bassPulse: 0.15, transition: ['fade', 4] },
      buildup: { front: 0.25, back: 0.3,  center: 0.25,movement: 'slow',   strobe: 0, beatFlash: 0.15,bassPulse: 0.2,  transition: ['fade', 3] },
      verse:   { front: 0.2,  back: 0.28, center: 0.2, movement: 'static', strobe: 0, beatFlash: 0.1, bassPulse: 0.15, transition: ['fade', 3.5] },
      chorus:  { front: 0.35, back: 0.4,  center: 0.32,movement: 'slow',   strobe: 0, beatFlash: 0.2, bassPulse: 0.25, transition: ['crossfade', 2.5] },
      drop:    { front: 0.4,  back: 0.45, center: 0.4, movement: 'slow',   strobe: 0, beatFlash: 0.25,bassPulse: 0.3,  transition: ['fade', 2] },
      outro:   { front: 0.12, back: 0.2,  center: 0.12,movement: 'static', strobe: 0, beatFlash: 0.05,bassPulse: 0.1,  transition: ['fade', 5] },
    },
  },
  cinematic: {
    label: 'Cinematic',
    palette: [rgb(0.85, 0.65, 0.3), rgb(0.15, 0.25, 0.5), rgb(0.6, 0.15, 0.2), rgb(0.9, 0.9, 0.8)],
    sections: {
      intro:   { front: 0.08, back: 0.4,  center: 0.1, movement: 'static', strobe: 0, beatFlash: 0.1, bassPulse: 0.1,  transition: ['fade', 4] },
      buildup: { front: 0.2,  back: 0.55, center: 0.2, movement: 'slow',   strobe: 0, beatFlash: 0.2, bassPulse: 0.25, transition: ['fade', 3] },
      verse:   { front: 0.15, back: 0.45, center: 0.15,movement: 'static', strobe: 0, beatFlash: 0.15,bassPulse: 0.15, transition: ['fade', 3] },
      chorus:  { front: 0.45, back: 0.75, center: 0.4, movement: 'slow',   strobe: 0, beatFlash: 0.35,bassPulse: 0.4,  transition: ['crossfade', 2] },
      drop:    { front: 0.65, back: 0.9,  center: 0.7, movement: 'medium', strobe: 0.05, beatFlash: 0.5,bassPulse: 0.55,transition: ['fade', 1.5] },
      outro:   { front: 0.05, back: 0.3,  center: 0.05,movement: 'static', strobe: 0, beatFlash: 0.05,bassPulse: 0.1, transition: ['fade', 5] },
    },
  },
};

export const STYLE_IDS = Object.keys(STYLES);

/** Simple deterministic PRNG so a given (style, section index) always yields the same variation. */
function seededRandom(seed) {
  let t = seed + 0x6d2b79f5;
  return function () {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds a concrete Scene for one detected section, given a style. `seedIndex`
 * (section position in the song) drives palette rotation + jitter so
 * consecutive sections of the same label don't look identical (brief §9: add
 * variation so the result does not look repetitive).
 */
export function buildSceneForSection(styleId, sectionLabel, seedIndex = 0) {
  const style = STYLES[styleId] || STYLES.edm;
  const profile = style.sections[sectionLabel] || style.sections.verse;
  const rnd = seededRandom(seedIndex * 97 + styleId.length);

  const palette = style.palette;
  const primary = palette[seedIndex % palette.length];
  const secondary = palette[(seedIndex + 1 + Math.floor(rnd() * 2)) % palette.length];
  const jitter = () => 1 + (rnd() - 0.5) * 0.12;

  const [transitionType, transitionDuration] = profile.transition;

  return createScene(
    `${style.label} · ${sectionLabel}`,
    {
      front: { intensity: clamp01(profile.front * jitter()), color: primary, movement: profile.movement, strobe: profile.strobe },
      back: { intensity: clamp01(profile.back * jitter()), color: secondary, movement: profile.movement, strobe: profile.strobe * 0.6 },
      center: { intensity: clamp01(profile.center * jitter()), color: primary, movement: profile.movement, strobe: profile.strobe },
      left: { intensity: clamp01(profile.front * jitter()), color: secondary, movement: profile.movement, strobe: 0 },
      right: { intensity: clamp01(profile.front * jitter()), color: primary, movement: profile.movement, strobe: 0 },
    },
    {
      beatFlashGroups: ['movinghead', 'par', 'strobe'],
      beatFlashAmount: profile.beatFlash,
      bassPulseGroups: ['front', 'back'],
      bassPulseAmount: profile.bassPulse,
      onsetSparkleGroups: profile.strobe > 0.2 ? ['ledstrip'] : [],
    },
    { type: transitionType, duration: transitionDuration, easing: 'easeInOut' },
  );
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
