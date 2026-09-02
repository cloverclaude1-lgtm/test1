import { createFixture } from '../fixtures/Fixture.js';
import { builtinSceneLibrary } from '../lighting/scenes.js';

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

  return {
    version: PROJECT_VERSION,
    name: 'Untitled Show',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    style: 'edm',
    audio: null, // { fileName, dataUrl, analysis }
    fixtures: defaultRig(),
    customGroups: [],
    scenes,
    timeline: [],
    rules: [],
    settings: { volume: 0.9 },
  };
}

function defaultRig() {
  const specs = [
    ['movinghead', -2.5, 6.2, 2.5, 'Moving Head L'],
    ['movinghead', 2.5, 6.2, 2.5, 'Moving Head R'],
    ['movinghead', 0, 6.4, 0, 'Moving Head C'],
    ['spotlight', -2.5, 6.2, -4.5, 'Spotlight L'],
    ['spotlight', 2.5, 6.2, -4.5, 'Spotlight R'],
    ['par', -6.5, 6.0, 2.5, 'PAR Front L'],
    ['par', 6.5, 6.0, 2.5, 'PAR Front R'],
    ['par', -6.5, 6.0, -4.5, 'PAR Back L'],
    ['par', 6.5, 6.0, -4.5, 'PAR Back R'],
    ['strobe', 0, 6.2, 2.5, 'Strobe Bar'],
    ['ledstrip', 0, 0.15, 4.8, 'Stage Edge LED'],
  ];
  return specs.map(([type, x, y, z, name]) => createFixture(type, { position: { x, y, z }, name }));
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
  return raw;
}

/**
 * Saves a project to a local file via a Blob + `<a download>` click — the
 * simplest, most broadly reliable approach across normal browser tabs.
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
 * Safari has a long history of ignoring/partially-supporting the `download`
 * attribute, so on Safari the blob is also opened in a new tab as a manual
 * "Save As" fallback. Returns 'download' so the caller can show feedback.
 */
export function downloadProjectFile(project) {
  const filename = `${sanitizeFileName(project.name || 'lightstage-project')}.lightstage.json`;
  const json = serializeProject(project);

  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari has a long history of ignoring/partially-supporting the `download`
  // attribute; give Safari users a manual "Save As" path via a new tab too.
  // (Other browsers already handled the download above — no need to also pop a tab.)
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  if (isSafari) window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 4000);
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
