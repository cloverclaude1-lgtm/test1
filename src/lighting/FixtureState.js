// ---------------------------------------------------------------------------
// FixtureState — the abstract output of the lighting engine for one fixture,
// one frame. This is the ONLY thing the 3D renderer reads, and the only
// thing a future DMX/Art-Net backend would need to translate into channel
// values via a fixture profile (brief §24). Never add renderer- or
// hardware-specific fields here.
// ---------------------------------------------------------------------------

export function createDefaultFixtureState() {
  return {
    intensity: 0,       // 0..1
    color: { r: 1, g: 1, b: 1 }, // 0..1 each
    pan: 0,             // -1..1 (normalized; mapped to fixture's pan range by renderer)
    tilt: 0,            // -1..1
    zoom: 0.5,           // 0..1 (narrow..wide)
    strobe: 0,           // 0..1 (0 = solid on, >0 = strobe rate fraction)
  };
}

export function cloneFixtureState(s) {
  return { ...s, color: { ...s.color } };
}

/** Linear-interpolates two fixture states (used for scene crossfades). */
export function lerpFixtureState(a, b, t) {
  const lerp = (x, y) => x + (y - x) * t;
  return {
    intensity: lerp(a.intensity, b.intensity),
    color: {
      r: lerp(a.color.r, b.color.r),
      g: lerp(a.color.g, b.color.g),
      b: lerp(a.color.b, b.color.b),
    },
    pan: lerp(a.pan, b.pan),
    tilt: lerp(a.tilt, b.tilt),
    zoom: lerp(a.zoom, b.zoom),
    strobe: lerp(a.strobe, b.strobe),
  };
}

/** Applies a fixture's manual override on top of an engine-computed state. Null/undefined fields fall through. */
export function applyOverride(state, override) {
  if (!override) return state;
  const out = cloneFixtureState(state);
  if (override.intensity != null) out.intensity = override.intensity;
  if (override.color) out.color = { ...out.color, ...override.color };
  if (override.pan != null) out.pan = override.pan;
  if (override.tilt != null) out.tilt = override.tilt;
  if (override.zoom != null) out.zoom = override.zoom;
  if (override.strobe != null) out.strobe = override.strobe;
  return out;
}
