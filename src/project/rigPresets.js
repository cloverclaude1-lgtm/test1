import { createFixture } from '../fixtures/Fixture.js';

// ---------------------------------------------------------------------------
// Fixture rig presets — brief ask: "a lot of options of layouts, not just
// one." Each preset is a list of [type, x, y, z, name] specs, the same shape
// the original single default rig used. Applying a preset ADDS its fixtures
// to the current rig (never replaces/deletes what's already there) so users
// can freely combine presets or keep customizing after applying one.
// ---------------------------------------------------------------------------

export const RIG_PRESETS = {
  wideSymmetric: {
    label: 'Wide Symmetric',
    specs: [
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
    ],
  },
  frontWall: {
    label: 'Front Wall',
    specs: [
      ['par', -7, 6.0, 2.5, 'Wall PAR 1'],
      ['par', -4.2, 6.0, 2.5, 'Wall PAR 2'],
      ['par', -1.4, 6.0, 2.5, 'Wall PAR 3'],
      ['par', 1.4, 6.0, 2.5, 'Wall PAR 4'],
      ['par', 4.2, 6.0, 2.5, 'Wall PAR 5'],
      ['par', 7, 6.0, 2.5, 'Wall PAR 6'],
      ['ledstrip', -3, 0.15, 4.9, 'Front Edge LED L'],
      ['ledstrip', 3, 0.15, 4.9, 'Front Edge LED R'],
    ],
  },
  circular: {
    label: 'Circular',
    specs: circleSpecs(),
  },
  minimal: {
    label: 'Minimal',
    specs: [
      ['movinghead', 0, 6.3, 0, 'Hero Moving Head'],
      ['par', -4, 6.0, 2, 'PAR L'],
      ['par', 4, 6.0, 2, 'PAR R'],
    ],
  },
  bigArena: {
    label: 'Big Arena',
    specs: [
      ['movinghead', -6, 7.5, 2.5, 'Arena MH 1'],
      ['movinghead', -2, 7.8, 2.5, 'Arena MH 2'],
      ['movinghead', 2, 7.8, 2.5, 'Arena MH 3'],
      ['movinghead', 6, 7.5, 2.5, 'Arena MH 4'],
      ['spotlight', -6, 7.5, -5.5, 'Arena Spot L'],
      ['spotlight', 6, 7.5, -5.5, 'Arena Spot R'],
      ['par', -9, 7.0, 2.5, 'Arena PAR 1'],
      ['par', -9, 7.0, -5.5, 'Arena PAR 2'],
      ['par', 9, 7.0, 2.5, 'Arena PAR 3'],
      ['par', 9, 7.0, -5.5, 'Arena PAR 4'],
      ['strobe', -3, 7.5, 2.5, 'Arena Strobe L'],
      ['strobe', 3, 7.5, 2.5, 'Arena Strobe R'],
      ['ledstrip', 0, 0.15, 5.5, 'Arena Edge LED'],
    ],
  },
};

function circleSpecs() {
  const specs = [];
  const count = 8;
  const radius = 5;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const type = i % 2 === 0 ? 'movinghead' : 'spotlight';
    specs.push([type, Math.cos(angle) * radius, 6.2, Math.sin(angle) * radius, `Ring ${i + 1}`]);
  }
  return specs;
}

export const RIG_PRESET_IDS = Object.keys(RIG_PRESETS);

/** Legacy default rig — kept as its own export so ProjectManager's fresh-project shape doesn't change. */
export function defaultRig() {
  return instantiate(RIG_PRESETS.wideSymmetric.specs);
}

function instantiate(specs) {
  return specs.map(([type, x, y, z, name]) => createFixture(type, { position: { x, y, z }, name }));
}

/** Adds a preset's fixtures onto the project's existing rig. Returns how many were added. */
export function applyRigPreset(project, presetId) {
  const preset = RIG_PRESETS[presetId];
  if (!preset) return 0;
  const fixtures = instantiate(preset.specs);
  project.fixtures.push(...fixtures);
  return fixtures.length;
}
