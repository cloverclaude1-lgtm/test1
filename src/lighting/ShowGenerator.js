import { buildSceneForSection } from './stylePresets.js';

// ---------------------------------------------------------------------------
// ShowGenerator — "Generate Show" (brief §9)
//
// Turns a pre-computed song analysis (sections + bpm) and a chosen style into
// a Timeline: an ordered list of scene "cues" covering the whole song, each
// naming a Scene (mood/look) and a transition into it. This is deliberately
// separate from moment-to-moment reactivity (beat flashes, bass pulses),
// which lives in each Scene's `reactions` and is applied live by
// LightingEngine — the generator only decides the song's macro structure:
//
//   INTRO -> BUILDUP -> DROP -> VERSE -> CHORUS -> DROP -> OUTRO
//
// If AudioAnalyzer could not find clear structure (e.g. a very short or
// unusually mixed clip) we fall back to a synthetic arc sized in musical bars
// so the show still has a beginning/build/climax/ending shape instead of one
// flat scene for the whole song.
// ---------------------------------------------------------------------------

const FALLBACK_ARC = ['intro', 'buildup', 'chorus', 'verse', 'drop', 'chorus', 'verse', 'drop', 'outro'];

function synthesizeSections(duration, bpm) {
  const secondsPerBar = (60 / bpm) * 4;
  const introLen = Math.min(duration * 0.12, secondsPerBar * 8);
  const outroLen = Math.min(duration * 0.1, secondsPerBar * 8);
  const middle = Math.max(0, duration - introLen - outroLen);

  const middleLabels = FALLBACK_ARC.slice(1, -1);
  const chunkLen = middle / middleLabels.length;

  const sections = [{ start: 0, end: introLen, label: 'intro' }];
  let t = introLen;
  for (const label of middleLabels) {
    sections.push({ start: t, end: t + chunkLen, label });
    t += chunkLen;
  }
  sections.push({ start: t, end: duration, label: 'outro' });
  return sections;
}

/**
 * @param {import('../audio/AudioAnalyzer.js').AnalysisResult} analysis
 * @param {string} styleId
 * @returns {{ scenes: Object<string, Scene>, timeline: Array }}
 */
export function generateShow(analysis, styleId) {
  const usableSections =
    analysis.sections && analysis.sections.length >= 2
      ? analysis.sections
      : synthesizeSections(analysis.duration, analysis.bpm || 120);

  const scenes = {};
  const timeline = [];

  usableSections.forEach((section, i) => {
    const scene = buildSceneForSection(styleId, section.label, i);
    scenes[scene.id] = scene;
    timeline.push({
      id: `cue_${i}`,
      startTime: section.start,
      endTime: section.end,
      sceneId: scene.id,
      label: section.label,
      transitionType: scene.transition.type,
      transitionDuration: scene.transition.duration,
    });
  });

  return { styleId, scenes, timeline };
}

/**
 * Finds the timeline entry active at `time`, plus the previous one (for crossfade
 * blending). The auto-generator always produces contiguous, gap-free cues, so a "no
 * exact match" only used to happen before the first cue or after the last — but manual
 * editing (drag a cue, delete one) can now leave real gaps in the middle of the
 * timeline too. When `time` lands in a gap, pick whichever cue's span is closest
 * rather than always falling through to the last cue in the array.
 */
export function findActiveCue(timeline, time) {
  if (!timeline.length) return { active: null, prev: null, index: -1 };

  let index = -1;
  for (let i = 0; i < timeline.length; i++) {
    if (time >= timeline[i].startTime && time < timeline[i].endTime) {
      index = i;
      break;
    }
  }

  if (index === -1) {
    let bestDist = Infinity;
    for (let i = 0; i < timeline.length; i++) {
      const dist = time < timeline[i].startTime ? timeline[i].startTime - time : time - timeline[i].endTime;
      if (dist < bestDist) {
        bestDist = dist;
        index = i;
      }
    }
  }

  const active = timeline[index];
  const prev = index > 0 ? timeline[index - 1] : null;
  return { active, prev, index };
}
