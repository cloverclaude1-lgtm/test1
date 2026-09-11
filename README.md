# LightStage

A music-reactive concert lighting designer. Import a song, drop lights on a virtual
stage, hit **Generate Show**, press **Play** — the rig lights up in sync with the
music.

```
Music → Audio Analysis → Lighting Engine → Virtual Concert Stage
```

## Quick start

```bash
npm install
npm run dev      # opens a Vite dev server, e.g. http://localhost:5173
```

Open the URL in a browser, click **Use Demo Song** (a short synthetic track generated
by `scripts/make-demo-audio.mjs` — no external assets needed), pick a style, and click
**Generate Show**. Press **Play**.

To run it as a desktop app instead of a browser tab:

```bash
npm run dev            # keep this running in one terminal
npm run electron       # in a second terminal — opens a native window pointed at it
```

For a production build:

```bash
npm run build           # outputs dist/
npm run preview         # serve dist/ locally to sanity-check it
# or: npm run electron   after building, once electron/main.cjs is pointed at dist/
```

There is no backend/server component — everything (audio decoding, analysis, the 3D
stage, project save/load) runs client-side in the browser's own APIs (Web Audio,
Canvas/WebGL, File/Blob). This is what let the whole app be built and *tested* — not
just described — inside a sandboxed, GUI-less environment: it runs identically headless
under Playwright/Chromium as it does in a user's own browser or in Electron's Chromium
shell.

## Technology choice

Vite + vanilla JS (ES modules) + Three.js, run inside Electron for desktop packaging.
The brief allows either a native C++/JUCE build or "a technology stack that allows the
MVP to be built and demonstrated quickly." A browser-based stack was the pragmatic
choice here: Web Audio gives real decoding/playback/FFT primitives for free, Three.js
gives GPU-accelerated 3D rendering for free, and the whole thing is trivially testable
in a headless Chromium instance (which is exactly how this build was verified end to
end — see "How this was tested" below) — no native toolchain, no display server, no
guesswork about whether the code actually runs. Electron just wraps the same web app
for a native window; no app code depends on Electron APIs, so it also runs as a normal
website.

## Architecture

```
UI  →  Project System  →  Audio Analysis  →  Lighting Engine  →  Fixture Abstraction  →  Renderer
```

```
src/
  audio/
    fft.js              radix-2 FFT + Hann window (no external DSP deps)
    AudioAnalyzer.js     one-time OFFLINE analysis pass over a decoded song
    FeatureStream.js     the audio.bass / audio.beat / ... interface (brief §7)
    AudioEngine.js        decoding + Web Audio playback/transport
  fixtures/
    Fixture.js            fixture data model + capabilities table
  lighting/
    FixtureState.js        the abstract output type (renderer- and DMX-agnostic)
    Groups.js                built-in + custom fixture groups
    scenes.js                 Scene data model + a small manual scene library
    stylePresets.js            EDM/Rock/Pop/Chill/Cinematic → per-section look tables
    ShowGenerator.js             turns analysis + style into a Timeline of scene cues
    RuleEngine.js                  WHEN/AND/OR/NOT condition evaluation (pure)
    LightingEngine.js                combines all of the above into FixtureStates
  stage/
    StageRenderer.js       Three.js scene: stage, truss, beams, fixtures, camera
  project/
    ProjectManager.js       versioned JSON project schema, save/load
  ui/                        small presentational modules (no engine logic)
  App.js                     top-level controller wiring UI ↔ engines ↔ renderer
electron/main.cjs           minimal desktop shell (loads the same web app)
scripts/make-demo-audio.mjs synthesizes public/demo-song.wav (no external assets)
```

**The lighting engine never imports Three.js**, and the renderer never imports audio
or lighting-engine internals — `LightingEngine.update()` is a pure function of
`(time, audioFeatures, project) → Map<fixtureId, FixtureState>`, and `StageRenderer`
only ever consumes that Map. That seam is deliberate (brief §3/§24): a future DMX/
Art-Net/sACN output would plug in at exactly the same point the renderer does today,
translating `FixtureState` into channel values via a per-fixture profile, without
touching audio analysis or show generation at all.

## How the audio-analysis pipeline works

`AudioAnalyzer.analyze()` runs once per imported song (not every frame during
playback) and produces a fully pre-computed timeline. Because the whole song is known
up front, this is far more accurate than reacting frame-by-frame during playback —
beat grids and section boundaries are exact against the recorded waveform rather than
guessed in real time (brief §6/§21).

1. **Decode** the file via `AudioContext.decodeAudioData`, mix to mono.
2. **Framing**: 2048-sample windows (Hann-windowed), 1024-sample hop (50% overlap).
3. **Per-frame FFT** → magnitude spectrum → bass (20–250Hz) / mid (250–4000Hz) /
   treble (4000–12000Hz) energy sums, spectral centroid, and broadband RMS (loudness).
   Each continuous feature is normalized to 0..1 by its own 95th-percentile value so
   quiet and loud songs both use the full range (brief §6's `bass=0.82` example).
4. **Beat detection**: adaptive-threshold peak-picking on the *bass* energy envelope
   (kick/beat-driven material) — a classic variance-adjusted "sound energy" algorithm
   (Patin). **Onset detection**: the same peak-picker applied to spectral flux
   (frame-to-frame spectral change), catching any instrument attack, not just kicks.
5. **BPM**: histogram of inter-beat intervals (50–200 BPM), folding half/double-tempo
   buckets together, picking the strongest.
6. **Section detection**: a coarse (2-second-bucket) smoothed energy curve is
   segmented into low/mid/high bands with an 8-second minimum section length, then
   labeled `intro / buildup / verse / chorus / drop / outro` from position + trend
   (ramping into a high section → "buildup"; a sustained low section at the start →
   "intro"; etc.). This is a heuristic, not real music-structure ML — see Limitations.
7. All of the above are also emitted as a flat, timestamped **event list**
   (`KICK`, `ONSET`, `ENERGY_UP`, `ENERGY_DOWN`, `SILENCE`, `SECTION_CHANGE`), which is
   what `RuleEngine` conditions like "beat detected" or "energy increasing" read.

`FeatureStream` wraps that result and is the *only* thing the lighting engine talks
to — `audio.bass`, `audio.beat`, `audio.bpm`, etc. (brief §7). A future live-microphone
input would implement the same interface computed frame-by-frame in real time instead
of by pre-analysis, and nothing in `LightingEngine` or `RuleEngine` would need to
change.

## How the automatic show generator works

`ShowGenerator.generateShow(analysis, styleId)` deliberately separates two concerns
that are easy to conflate:

- **Macro structure** (this module): which *mood* is active when. It walks the
  detected sections and, for each one, looks up `stylePresets.js`'s per-style,
  per-section-label profile (brightness per group, movement speed, strobe amount,
  reaction sensitivity) to build a concrete `Scene`, then rotates through that style's
  color palette across sections so consecutive sections of the same label don't look
  identical (brief §9: "add variation"). The result is a `Timeline`: an ordered list
  of `{startTime, endTime, sceneId, transition}` cues spanning the whole song. If a
  song analyzes as one flat section (rare, but possible for very short or unusual
  clips), a synthetic `intro → buildup → chorus → verse → drop → chorus → verse → drop
  → outro` arc is sized in musical bars instead of one flat scene for the entire song.

- **Moment-to-moment reactivity** (`LightingEngine`, live, every frame): each `Scene`
  also carries a `reactions` config (which groups flash on beat, which pulse with
  bass, by how much). `LightingEngine` reads `audio.bass` / beat events live and
  applies these continuously — this is *not* baked into the timeline as thousands of
  discrete per-beat events, both because that would be enormous for a multi-minute
  song and because it's a better model of how lighting design actually works: a
  fixed look that *responds* to what's happening musically, rather than a giant
  pre-scripted flash list. This is also explicitly why `Bass = red, Beat = flash`
  alone was avoided (brief §9): every section has its own palette, brightness curve,
  and movement character, and the reaction *rules* on top of that vary by style and
  by section (a "drop" flashes hard on every beat; a "verse" barely reacts at all).

Fixture movement (pan/tilt sweep) is procedural, keyed off each scene's `movement`
setting (`static/slow/medium/fast/chaos`) plus a per-fixture phase offset so fixtures
don't move in lockstep, and `chaos` (used on drops) samples a new random aim point a
few times a second for the "genuinely different every drop" feel brief §9 asks for.

## Rule Builder (advanced)

A small WHEN/AND-OR-NOT/THEN system (`lighting/RuleEngine.js` + `ui/RuleBuilder.js`)
layered *on top of* the generated show — never replacing it. Conditions read the same
`audio.*` feature/event interface (bass/mid/treble/energy thresholds, beat/onset
detected, energy increasing/decreasing, silence, section changed). Actions target a
group (built-in role/type group, or a custom one) with `setBrightness`, `changeColor`,
`flash`, `strobe`, `move`, `fade`, `pulse`, `changeScene`, or `setGroupEnabled`. No
code, no channel numbers — just a form.

## Manual overrides (brief §20)

Every fixture carries an `override` object layered on top of whatever the engine
computes, per field (brightness/color/pan/tilt/zoom/strobe). Checking "Manual X" in
the Properties panel pins that one field; unchecking it returns that field to the
automatic show. Nothing about generating or regenerating a show ever touches these —
only the user does.

## Project files (brief §23)

A `.lightstage.json` file is one versioned document: rig, groups, scenes, generated
timeline, rules, style, and the song itself (embedded as a data URL) *plus* its
pre-computed analysis, so reopening a project is instant — no re-analysis pass.
`PROJECT_VERSION` exists so a future release can migrate older files.

## Implemented features

- Project create/save/reopen (versioned local JSON, embeds the audio)
- Drag-and-drop or file-picker song import; synthetic demo song included
- Full offline audio analysis: bass/mid/treble/energy/spectral centroid (0..1
  normalized), BPM, beat/onset detection, section detection, discrete event timeline
- `audio.*` feature interface decoupling the lighting engine from analysis internals
- Automatic show generation with musical structure, per-style palettes/behavior, and
  cross-section variation; regeneratable at any time by changing style
- 5 style presets (EDM, Rock, Pop, Chill, Cinematic)
- 3D stage (floor, backdrop, truss, center mark, screen) with orbit/pan/zoom camera
- 5 fixture types (PAR, Spotlight, Moving Head, Strobe, LED Strip with per-pixel chase)
  with beams, colored point lights, and strobe flicker
- Fixture add/select/drag-to-move (grid-snapped)/duplicate/delete/rename/enable-toggle
- Built-in groups (front/back/left/right/center/by-type/all) + custom groups
- Reusable scene library + generated per-section scenes, applicable manually
- Visual WHEN/AND-OR-NOT/THEN rule builder (9 condition types, 9 action types)
- Manual per-fixture overrides that never get clobbered by (re)generation
- Simplified timeline: waveform + beat ticks + generated scene cues + playhead,
  click-to-seek
- Play/Pause/Stop/Seek with synced audio + lighting clocks

## Known limitations (MVP scope)

- **Section labeling is heuristic**, not learned music-structure analysis — it can
  mislabel or under-segment unusual songs (documented in AudioAnalyzer.js). It still
  reliably finds *where* energy changes, even when a label is approximate.
- **No DMX/Art-Net/sACN/MIDI/OSC output** yet, by design (brief §25) — `FixtureState`
  is already hardware-agnostic so this is additive, not a rewrite.
- **Timeline editing is view + seek only** — cue boundaries aren't yet drag-resizable
  from the timeline UI (scenes can still be swapped via the Scene panel or a
  `changeScene` rule). The data model (`project.timeline`) already supports it.
- **`changeScene` rule action latches** until another `changeScene` rule fires or the
  user clears the override — there's no automatic "revert after N seconds."
- **LED strip pixel effects are a simple procedural chase**, not individually
  editable per-pixel.
- Real-time performance depends on the browser's GPU; this was verified functionally
  correct under headless software rendering (Playwright + SwiftShader, ~8-10fps) —
  expect the target 60fps on an actual GPU in a real browser/Electron window.
- No cloud sync, accounts, or multi-user features (out of scope by brief §25).

## How this was tested

No GUI/display was available in the build environment, so the full user flow was
driven end-to-end with Playwright against a headless Chromium: import (demo) song →
watch the analysis checklist complete → pick a style → Generate Show → enter the
editor → verify the rig renders and reacts → Play/seek/Stop → switch styles live →
add/select/duplicate/delete a fixture → edit its properties → open the rule builder,
build a WHEN/THEN rule → save a project → reopen it in a fresh page load → confirm
audio, rig, rules, and timeline all restored → verify a production `vite build` boots
identically. Screenshots were captured at each step; zero console/page errors across
the whole run. This is the same reason the stack was chosen (see "Technology choice")
— a real browser, not a mock, exercising real Web Audio decode/analysis and real
WebGL rendering.
