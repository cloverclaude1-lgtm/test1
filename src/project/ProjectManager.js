import { FIXTURE_TYPES } from '../fixtures/Fixture.js';
import { builtinSceneLibrary } from '../lighting/scenes.js';
import { defaultRig } from './rigPresets.js';

// ---------------------------------------------------------------------------
// ProjectManager — local project files (brief §23).
//
// A LightStage project is one versioned JSON document containing everything
// needed to reopen a show exactly as it was left: the audio itself (embedded
// as a data URL so the file is self-contained), its pre-computed analysis
// (so reopening is instant, no re-analysis pass), the rig, groups, scenes,
// generated timeline and rules. `PROJECT_VERSION` exists so a future release
// can migrate older project files instead of breaking them.
// ---------------------------------------------------------------------------

export const PROJECT_VERSION = 1;

export function createDefaultProject() {
  const scenes = {};
  for (const s of builtinSceneLibrary()) scenes[s.id] = s;

  return hydrateProject({
    version: PROJECT_VERSION,
    name: 'Untitled Show',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    style: 'edm',
    stageLayout: 'arena',
    audio: null, // { fileName, dataUrl, analysis }
    fixtures: defaultRig(),
    customGroups: [],
    scenes,
    timeline: [],
    rules: [],
    settings: { volume: 0.9 },
  });
}

// -- Serialization ----------------------------------------------------------

function analysisToJSON(analysis) {
  if (!analysis) return null;
  return {
    ...analysis,
    frames: {
      bass: Array.from(analysis.frames.bass),
      mid: Array.from(analysis.frames.mid),
      treble: Array.from(analysis.frames.treble),
      energy: Array.from(analysis.frames.energy),
      centroid: Array.from(analysis.frames.centroid),
    },
  };
}

function analysisFromJSON(json) {
  if (!json) return null;
  return {
    ...json,
    frames: {
      bass: Float32Array.from(json.frames.bass),
      mid: Float32Array.from(json.frames.mid),
      treble: Float32Array.from(json.frames.treble),
      energy: Float32Array.from(json.frames.energy),
      centroid: Float32Array.from(json.frames.centroid),
    },
  };
}

export function serializeProject(project) {
  const out = {
    ...project,
    updatedAt: Date.now(),
    audio: project.audio
      ? { fileName: project.audio.fileName, dataUrl: project.audio.dataUrl, analysis: analysisToJSON(project.audio.analysis) }
      : null,
  };
  return JSON.stringify(out);
}

export function deserializeProject(jsonString) {
  const raw = JSON.parse(jsonString);
  if (raw.version !== PROJECT_VERSION) {
    // Placeholder for future migrations — MVP only ships version 1.
    raw.version = PROJECT_VERSION;
  }
  if (raw.audio) raw.audio.analysis = analysisFromJSON(raw.audio.analysis);
  return hydrateProject(raw);
}

const DEFAULT_REACTIONS = { beatFlashGroups: [], beatFlashAmount: 0.6, bassPulseGroups: [], bassPulseAmount: 0.5, onsetSparkleGroups: [] };
const DEFAULT_TRANSITION = { type: 'fade', duration: 2.0, easing: 'easeInOut' };
const DEFAULT_AUDIO_REACTIVITY = { band: 'none', mode: 'gate', threshold: 0.5 };

/**
 * Repairs a project's shape after loading (or before first use) so an older
 * schema, a hand-edited file, or a project saved by an earlier version of the
 * app can never carry a landmine into the real-time render loop. Every field
 * this fills in mirrors the same default some in-app creation path (e.g.
 * `createFixture`/`createScene`) already uses, so a "hydrated" project is
 * indistinguishable from one that was always shaped that way.
 */
export function hydrateProject(project) {
  project.fixtures = (project.fixtures || []).map((f) => {
    if (!FIXTURE_TYPES[f.type]) {
      console.warn(`LightStage: unknown fixture type "${f.type}" on "${f.name || f.id}" — treating it as a PAR.`);
      f.type = 'par';
    }
    f.params = { ...FIXTURE_TYPES[f.type].defaultParams, ...(f.params || {}) };
    f.position = f.position || { x: 0, y: 3, z: 0 };
    if (typeof f.enabled !== 'boolean') f.enabled = true;
    f.audioReactivity = { ...DEFAULT_AUDIO_REACTIVITY, ...(f.audioReactivity || {}) };
    f.keyframes = Array.isArray(f.keyframes) ? f.keyframes : [];
    return f;
  });

  project.customGroups = (project.customGroups || []).map((g) => ({
    ...g,
    fixtureIds: Array.isArray(g.fixtureIds) ? g.fixtureIds : [],
  }));

  for (const scene of Object.values(project.scenes || {})) {
    scene.groups = scene.groups || {};
    scene.reactions = { ...DEFAULT_REACTIONS, ...(scene.reactions || {}) };
    scene.transition = { ...DEFAULT_TRANSITION, ...(scene.transition || {}) };
  }

  project.rules = (project.rules || []).map((r) => ({
    ...r,
    conditions: Array.isArray(r.conditions) ? r.conditions : [],
    actions: Array.isArray(r.actions) ? r.actions : [],
  }));

  project.timeline = project.timeline || [];
  project.stageLayout = project.stageLayout || 'arena';
  // A hand-edited/corrupted file could claim 'custom' without the dimensions to back it up —
  // fall back to a known-good layout rather than handing StageRenderer.setLayout(undefined).
  if (project.stageLayout === 'custom' && !project.customStageLayout) project.stageLayout = 'arena';

  return project;
}

/**
 * Downloads any Blob to a local file via a temporary `<a download>` click —
 * the simplest, most broadly reliable approach across normal browser tabs.
 *
 * The File System Access API (`showSaveFilePicker`) was tried here first in
 * an earlier version, but it turned out to be a worse bet for this app: it
 * opens a real native OS dialog that can hang indefinitely with no visible
 * feedback when invoked inside a restricted/embedded preview surface (the
 * exact kind of environment — a sandboxed webview or forwarded-port preview —
 * this app is most often reported as "not working" from), and it isn't
 * available at all outside Chromium. The plain anchor-download path degrades
 * far more gracefully: it either downloads immediately or silently no-ops,
 * never hangs waiting on a dialog the user can't see.
 *
 * The anchor targets a new tab (`target="_blank"`) so that on any browser/embed
 * that ignores `download` (Safari has a long history of this, and sandboxed
 * previews may block it outright) the fallback is a new tab showing the file
 * instead of the current tab navigating away from the running app — which
 * otherwise reads as "the screen just goes black" right after saving.
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Saves a project to a local `.lightstage.json` file. Returns 'download' so the caller can show feedback. */
export function downloadProjectFile(project) {
  const filename = `${sanitizeFileName(project.name || 'lightstage-project')}.lightstage.json`;
  const json = serializeProject(project);
  downloadBlob(new Blob([json], { type: 'application/json' }), filename);
  return 'download';
}

function sanitizeFileName(name) {
  return name.replace(/[^a-z0-9-_ ]/gi, '').trim().replace(/\s+/g, '-') || 'lightstage-project';
}

export function readProjectFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(deserializeProject(reader.result));
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}
