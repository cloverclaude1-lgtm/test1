// ---------------------------------------------------------------------------
// Fixture data model
//
// A Fixture is pure data: identity, placement, and static capabilities. It
// carries NO lighting logic — LightingEngine reads fixtures + produces a
// FixtureState per frame (see lighting/FixtureState.js). This separation is
// what lets the same fixture list later be driven by DMX/Art-Net/sACN
// instead of (or alongside) the built-in engine, per brief §24.
// ---------------------------------------------------------------------------

export const FIXTURE_TYPES = {
  par: {
    label: 'PAR',
    capabilities: { color: true, pan: false, tilt: false, zoom: false, strobe: false },
    defaultParams: { beamAngle: 40 },
  },
  spotlight: {
    label: 'Spotlight',
    capabilities: { color: true, pan: true, tilt: true, zoom: false, strobe: false },
    defaultParams: { beamAngle: 20 },
  },
  movinghead: {
    label: 'Moving Head',
    capabilities: { color: true, pan: true, tilt: true, zoom: true, strobe: true },
    defaultParams: { beamAngle: 15, panRangeDeg: 270, tiltRangeDeg: 130 },
  },
  strobe: {
    label: 'Strobe',
    capabilities: { color: true, pan: false, tilt: false, zoom: false, strobe: true },
    defaultParams: { strobeRateHz: 10 },
  },
  ledstrip: {
    label: 'LED Strip',
    capabilities: { color: true, pan: false, tilt: false, zoom: false, strobe: false, pixels: true },
    defaultParams: { pixelCount: 12, lengthMeters: 2 },
  },
};

let nextId = 1;
export function makeFixtureId() {
  return `fx_${Date.now().toString(36)}_${(nextId++).toString(36)}`;
}

/** Infers a coarse rig role (front/back/left/right/center) from stage-space position. */
export function inferRole(position) {
  const { x, z } = position;
  if (Math.abs(x) > 3) return x < 0 ? 'left' : 'right';
  if (z < -1.5) return 'back';
  if (z > 1.5) return 'front';
  return 'center';
}

export function createFixture(type, { position, name, id, audioReactivity } = {}) {
  const def = FIXTURE_TYPES[type];
  if (!def) throw new Error(`Unknown fixture type: ${type}`);
  const pos = position || { x: 0, y: 3, z: 0 };
  return {
    id: id || makeFixtureId(),
    type,
    name: name || `${def.label} ${Math.floor(Math.random() * 900 + 100)}`,
    position: { x: pos.x, y: pos.y, z: pos.z },
    rotation: { x: 0, y: 0, z: 0 },
    role: inferRole(pos),
    groupIds: [],
    enabled: true,
    params: { ...def.defaultParams },
    baseColor: { r: 1, g: 1, b: 1 },
    // Optional per-fixture gate/modulation by a live audio frequency band, layered
    // into LightingEngine.update() after scenes/reactions/rules and before the
    // manual override — lets a fixture be "on when there's bass" etc. without
    // needing the full Rule Builder. 'none' (the default) leaves the fixture
    // entirely driven by the automatic show, same as before this field existed.
    audioReactivity: { band: 'none', mode: 'gate', threshold: 0.5, ...audioReactivity },
    // Per-fixture keyframe track: [{ id, time, state: {intensity,color,pan,tilt,zoom,strobe} }],
    // sorted by time. Empty = fixture behaves exactly as before (fully automatic/scene-driven).
    // Once non-empty, LightingEngine.update() holds/interpolates/holds across these for the
    // WHOLE song for this fixture, completely superseding the scene — see Timeline.js for the
    // per-fixture track UI and App.js's "+ Keyframe" for how entries get captured.
    keyframes: [],
    // Manual override layered on top of engine output each frame; null fields fall through
    // to the automatically generated / rule-driven state (brief §20: never destructive).
    override: null,
  };
}

export function fixtureCapabilities(fixture) {
  return FIXTURE_TYPES[fixture.type]?.capabilities || {};
}
