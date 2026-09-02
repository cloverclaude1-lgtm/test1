// ---------------------------------------------------------------------------
// Stage layouts (venue environments) — brief ask: "a lot of options of
// layouts, not just one." Each is a plain config, not bespoke per-layout
// code, so StageRenderer's `_buildStage()` stays one procedural function
// driven by whichever config is active. Switching layouts only rebuilds the
// environment (floor/truss/backdrop/screen/lighting/fog/camera framing) —
// fixtures the user has placed are never touched.
// ---------------------------------------------------------------------------

export const STAGE_LAYOUTS = {
  arena: {
    label: 'Arena',
    width: 16, depth: 11, trussY: 6.4,
    backdropWidth: 20, backdropHeight: 8,
    screenWidth: 6, screenHeight: 3.2,
    floorColor: 0x0c0d12, backdropColor: 0x08090d, trussColor: 0x2c2f3a,
    hemiSky: 0x445577, hemiGround: 0x050508, hemiIntensity: 0.35,
    fogColor: 0x030308, fogDensity: 0.045,
    camera: { pos: { x: 0, y: 7, z: 13 }, target: { x: 0, y: 2.5, z: -1 } },
  },
  club: {
    label: 'Club',
    width: 10, depth: 7, trussY: 4.2,
    backdropWidth: 14, backdropHeight: 6,
    screenWidth: 4, screenHeight: 2.2,
    floorColor: 0x14101c, backdropColor: 0x0d0810, trussColor: 0x33222c,
    hemiSky: 0x552244, hemiGround: 0x0a0508, hemiIntensity: 0.3,
    fogColor: 0x0d0810, fogDensity: 0.075,
    camera: { pos: { x: 0, y: 5, z: 9 }, target: { x: 0, y: 2, z: -0.5 } },
  },
  festival: {
    label: 'Festival',
    width: 26, depth: 16, trussY: 9,
    backdropWidth: 30, backdropHeight: 11,
    screenWidth: 10, screenHeight: 5,
    floorColor: 0x0a0d10, backdropColor: 0x06080a, trussColor: 0x2a3040,
    hemiSky: 0x3a5580, hemiGround: 0x04060a, hemiIntensity: 0.4,
    fogColor: 0x05070a, fogDensity: 0.03,
    camera: { pos: { x: 0, y: 10, z: 20 }, target: { x: 0, y: 3, z: -1 } },
  },
  theater: {
    label: 'Theater',
    width: 12, depth: 13, trussY: 5.5,
    backdropWidth: 14, backdropHeight: 9,
    screenWidth: 5, screenHeight: 3.6,
    floorColor: 0x120a0a, backdropColor: 0x0a0505, trussColor: 0x201818,
    hemiSky: 0x664433, hemiGround: 0x080404, hemiIntensity: 0.28,
    fogColor: 0x0a0505, fogDensity: 0.05,
    camera: { pos: { x: 0, y: 6, z: 12 }, target: { x: 0, y: 2.5, z: -1 } },
  },
};

export const STAGE_LAYOUT_IDS = Object.keys(STAGE_LAYOUTS);
