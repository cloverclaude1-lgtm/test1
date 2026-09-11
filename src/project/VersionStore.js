import { serializeProject } from './ProjectManager.js';

// ---------------------------------------------------------------------------
// Version history — local, named snapshots of a project ("Chicago load-in",
// "post-soundcheck", etc.) a user saves by hand at whatever points matter to
// them, so two dates on a tour can be compared or reverted to later. This app
// has no backend, so the store is IndexedDB in this browser — same
// no-server philosophy as project save/load (Blob download) and the PDF plot
// export. Each record embeds a full serialized project (the same JSON shape
// downloadProjectFile/readProjectFile use), so restoring one is exactly like
// opening a project file.
// ---------------------------------------------------------------------------

const DB_NAME = 'lightstage-versions';
const DB_VERSION = 1;
const STORE = 'versions';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function withStore(db, mode) {
  const t = db.transaction(STORE, mode);
  return { t, store: t.objectStore(STORE) };
}

let nextId = 1;
function makeVersionId() {
  return `ver_${Date.now().toString(36)}_${(nextId++).toString(36)}`;
}

/** Saves the current project as a new named version. Returns the stored record. */
export async function saveVersion(project, label) {
  const db = await openDB();
  const record = {
    id: makeVersionId(),
    label: label?.trim() || `Version — ${new Date().toLocaleString()}`,
    createdAt: Date.now(),
    meta: {
      fixtureCount: project.fixtures.length,
      sceneCount: Object.keys(project.scenes || {}).length,
      cueCount: (project.timeline || []).length,
      style: project.style,
      stageLayout: project.stageLayout,
    },
    projectJson: serializeProject(project),
  };
  return new Promise((resolve, reject) => {
    const { t, store } = withStore(db, 'readwrite');
    store.add(record);
    t.oncomplete = () => resolve(record);
    t.onerror = () => reject(t.error);
  });
}

/** All saved versions, newest first. Metadata only is cheap to render; the full
 * `projectJson` is included too (needed for restore/diff) but the list UI ignores it. */
export async function listVersions() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const { store } = withStore(db, 'readonly');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => b.createdAt - a.createdAt));
    req.onerror = () => reject(req.error);
  });
}

export async function deleteVersion(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const { t, store } = withStore(db, 'readwrite');
    store.delete(id);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/** A pragmatic, high-level diff between two version records — not a full JSON
 * diff, just the things worth comparing between two tour dates. `older`/`newer`
 * should already be ordered by the caller (diff reads naturally that direction). */
export function diffVersions(older, newer) {
  const a = JSON.parse(older.projectJson);
  const b = JSON.parse(newer.projectJson);
  const lines = [];

  if (a.style !== b.style) lines.push(`Style: ${a.style} → ${b.style}`);
  if (a.stageLayout !== b.stageLayout) lines.push(`Stage layout: ${a.stageLayout} → ${b.stageLayout}`);

  const fixturesA = new Map((a.fixtures || []).map((f) => [f.id, f]));
  const fixturesB = new Map((b.fixtures || []).map((f) => [f.id, f]));
  const added = [...fixturesB.keys()].filter((id) => !fixturesA.has(id));
  const removed = [...fixturesA.keys()].filter((id) => !fixturesB.has(id));
  const moved = [...fixturesB.keys()].filter((id) => {
    if (!fixturesA.has(id)) return false;
    const pa = fixturesA.get(id).position, pb = fixturesB.get(id).position;
    return pa.x !== pb.x || pa.y !== pb.y || pa.z !== pb.z;
  });
  if (added.length) lines.push(`+${added.length} fixture(s) added: ${added.map((id) => fixturesB.get(id).name).join(', ')}`);
  if (removed.length) lines.push(`-${removed.length} fixture(s) removed: ${removed.map((id) => fixturesA.get(id).name).join(', ')}`);
  if (moved.length) lines.push(`${moved.length} fixture(s) repositioned: ${moved.map((id) => fixturesB.get(id).name).join(', ')}`);

  const scenesA = Object.keys(a.scenes || {}).length;
  const scenesB = Object.keys(b.scenes || {}).length;
  if (scenesA !== scenesB) lines.push(`Scenes: ${scenesA} → ${scenesB}`);

  const cuesA = (a.timeline || []).length;
  const cuesB = (b.timeline || []).length;
  if (cuesA !== cuesB) lines.push(`Timeline cues: ${cuesA} → ${cuesB}`);

  const rulesA = (a.rules || []).length;
  const rulesB = (b.rules || []).length;
  if (rulesA !== rulesB) lines.push(`Rules: ${rulesA} → ${rulesB}`);

  if (lines.length === 0) lines.push('No structural differences detected.');
  return lines;
}
