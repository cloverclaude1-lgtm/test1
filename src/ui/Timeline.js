// ---------------------------------------------------------------------------
// Timeline (brief §19) — an editable, editing-suite-style sequence track.
//
// Four lanes, top to bottom: energy envelope, scene-cue blocks (project.timeline),
// the SELECTED fixture's keyframe track, and beat ticks. Lets the user rearrange
// the sequence directly:
//   - drag a scene from the Scene Library and drop it on the timeline to place it
//   - drag a cue's left/right edge to resize it, or its body to move it (snaps to
//     0, the song's end, and other cues' edges)
//   - drag a keyframe diamond to retime it, or click it to select it (snaps the
//     same way; keyframes are instants, so no resize handles)
//   - click empty space to seek, same as before
// All of this just mutates `project.timeline` / `fixture.keyframes` in place —
// LightingEngine reads both fresh every frame either way, so no "apply" step exists.
// ---------------------------------------------------------------------------

export const SECTION_COLORS = {
  intro: '#3a6ea8', buildup: '#c98a2e', drop: '#e0348f', chorus: '#7c5cff', verse: '#34a891', outro: '#555b6e',
};

const EDGE_TOLERANCE_PX = 8;
const KEYFRAME_HIT_RADIUS_PX = 9;
const MOVE_THRESHOLD_PX = 3;
const SNAP_PX = 8;
const MIN_CUE_DURATION = 0.3;
const DEFAULT_DROPPED_DURATION = 8;

/** Renders a static legend (once) explaining the timeline's lanes and colors. */
export function renderTimelineLegend(container) {
  container.innerHTML = '';
  const items = [
    { swatchClass: 'line', color: '#7c5cff', label: 'Energy' },
    ...Object.entries(SECTION_COLORS).map(([label, color]) => ({ swatchClass: '', color, label: capitalize(label) })),
    { swatchClass: 'diamond', color: '#ffd166', label: 'Keyframes' },
    { swatchClass: 'tick', color: null, label: 'Beats' },
  ];
  for (const item of items) {
    const el = document.createElement('span');
    el.className = 'legend-item';
    const swatch = document.createElement('span');
    swatch.className = `legend-swatch ${item.swatchClass}`;
    if (item.color) swatch.style.background = item.color;
    el.append(swatch, item.label);
    container.appendChild(el);
  }
  const hint = document.createElement('span');
  hint.className = 'legend-item';
  hint.textContent = '· click to seek · drag cue edges to resize · drag a scene here to place it';
  container.appendChild(hint);
}

function capitalize(s) { return s[0].toUpperCase() + s.slice(1); }

/** Same "first group's color" rule SceneList.js uses, so a cue matches its scene's swatch. */
function colorFromScene(scene) {
  const g = scene?.groups && Object.values(scene.groups)[0];
  if (!g) return null;
  return `rgb(${Math.round(g.color.r * 255)}, ${Math.round(g.color.g * 255)}, ${Math.round(g.color.b * 255)})`;
}

function colorFromKeyframe(kf) {
  const c = kf.state?.color;
  if (!c) return '#ffd166';
  return `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`;
}

export class TimelineView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onSeek = null;
    this.onCueChange = null;      // (cueId, {startTime, endTime}) => void — called live during resize/move
    this.onCueSelect = null;      // (cueId | null) => void
    this.onSceneDropped = null;   // (sceneId, time) => void
    this.onKeyframeChange = null; // (fixtureId, keyframeId) => void — called live during drag
    this.onKeyframeSelect = null; // (keyframeId | null) => void

    this._project = null;
    this._duration = 0;
    this._cueHitboxes = [];      // [{cueId, x0, x1, y0, y1}] rebuilt every draw()
    this._keyframeHitboxes = []; // [{keyframeId, x, y}] rebuilt every draw(), only for selectedFixtureId
    this.selectedCueId = null;
    this.selectedKeyframeId = null;
    this.selectedFixtureId = null; // set by App.js whenever fixture selection changes
    this._drag = null;

    canvas.addEventListener('pointerdown', this._onPointerDown.bind(this));
    canvas.addEventListener('pointermove', this._onPointerMove.bind(this));
    canvas.addEventListener('pointerup', this._onPointerUp.bind(this));
    canvas.addEventListener('pointercancel', () => { this._drag = null; });

    canvas.addEventListener('dragover', (e) => { e.preventDefault(); canvas.classList.add('drag-over'); });
    canvas.addEventListener('dragleave', () => canvas.classList.remove('drag-over'));
    canvas.addEventListener('drop', (e) => {
      e.preventDefault();
      canvas.classList.remove('drag-over');
      const sceneId = e.dataTransfer.getData('text/plain');
      if (!sceneId || !this._duration) return;
      this.onSceneDropped?.(sceneId, this._pixelToTime(e.clientX));
    });
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const { clientWidth, clientHeight } = this.canvas;
    this.canvas.width = clientWidth * dpr;
    this.canvas.height = clientHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  clearSelection() {
    this.selectedCueId = null;
  }

  clearKeyframeSelection() {
    this.selectedKeyframeId = null;
  }

  _selectedFixture() {
    if (!this.selectedFixtureId || !this._project) return null;
    return this._project.fixtures.find((f) => f.id === this.selectedFixtureId) || null;
  }

  draw(project, currentTime, duration) {
    this._project = project;
    this._duration = duration || 0;
    const { ctx, canvas } = this;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    if (!duration) {
      ctx.fillStyle = '#4a4e5c';
      ctx.font = '12px Inter, sans-serif';
      ctx.fillText('Import a song to see its timeline', 12, h / 2 + 4);
      this._cueHitboxes = [];
      this._keyframeHitboxes = [];
      return;
    }

    const analysis = project.audio?.analysis;
    const laneEnergy = h * 0.28;
    const laneScenes = h * 0.3;
    const laneKeyframes = h * 0.24;
    const laneBeats = h * 0.18;

    // Energy envelope
    if (analysis) {
      ctx.beginPath();
      ctx.strokeStyle = '#7c5cff';
      ctx.lineWidth = 1.2;
      const frames = analysis.frames.energy;
      const step = Math.max(1, Math.floor(frames.length / w));
      for (let x = 0; x < w; x++) {
        const idx = Math.min(frames.length - 1, x * step);
        const v = frames[idx] || 0;
        const y = laneEnergy - v * (laneEnergy - 4);
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Scene cue blocks — colored from the actual scene they reference so a manually
    // dropped scene (e.g. "Breathing") reads distinctly from a generated "verse" cue.
    // Bold/tall on purpose (brief ask: easy to grab, not a thin sliver).
    const cueY0 = laneEnergy + 5;
    const cueY1 = cueY0 + laneScenes - 8;
    this._cueHitboxes = [];
    for (const cue of project.timeline || []) {
      const x0 = (cue.startTime / duration) * w;
      const x1 = (cue.endTime / duration) * w;
      const scene = project.scenes?.[cue.sceneId];
      const fill = colorFromScene(scene) || SECTION_COLORS[cue.label] || '#555';
      const isSelected = cue.id === this.selectedCueId;

      ctx.fillStyle = fill;
      ctx.globalAlpha = 0.85;
      const radius = 4;
      roundRect(ctx, x0, cueY0, Math.max(2, x1 - x0 - 1), laneScenes - 8, radius);
      ctx.fill();
      ctx.globalAlpha = 1;

      if (isSelected) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        roundRect(ctx, x0 + 1, cueY0 + 1, Math.max(2, x1 - x0 - 3), laneScenes - 10, radius);
        ctx.stroke();
      }

      const text = scene?.name || cue.label || '';
      if (x1 - x0 > 34 && text) {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = 'bold 10.5px Inter, sans-serif';
        ctx.fillText(text, x0 + 6, cueY0 + laneScenes / 2 + 2);
      }

      this._cueHitboxes.push({ cueId: cue.id, x0, x1, y0: cueY0, y1: cueY1 });
    }

    // Per-fixture keyframe track (only the currently selected fixture)
    const kfY0 = laneEnergy + laneScenes;
    const kfCenterY = kfY0 + laneKeyframes / 2;
    this._keyframeHitboxes = [];
    const fixture = this._selectedFixture();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, kfCenterY);
    ctx.lineTo(w, kfCenterY);
    ctx.stroke();

    if (!fixture) {
      ctx.fillStyle = '#4a4e5c';
      ctx.font = '10px Inter, sans-serif';
      ctx.fillText('Select a fixture to view/add its keyframes', 12, kfCenterY + 3);
    } else {
      const keyframes = fixture.keyframes || [];
      for (const kf of keyframes) {
        const x = (kf.time / duration) * w;
        const isSelected = kf.id === this.selectedKeyframeId;
        const size = isSelected ? 8 : 6;
        ctx.save();
        ctx.translate(x, kfCenterY);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = colorFromKeyframe(kf);
        ctx.fillRect(-size / 2, -size / 2, size, size);
        if (isSelected) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(-size / 2 - 1.5, -size / 2 - 1.5, size + 3, size + 3);
        }
        ctx.restore();
        this._keyframeHitboxes.push({ keyframeId: kf.id, x, y: kfCenterY });
      }
      if (keyframes.length === 0) {
        ctx.fillStyle = '#4a4e5c';
        ctx.font = '10px Inter, sans-serif';
        ctx.fillText(`No keyframes yet on "${fixture.name}" — use "+ Keyframe" below`, 12, kfCenterY + 3);
      }
    }

    // Beat ticks
    if (analysis) {
      const yb = laneEnergy + laneScenes + laneKeyframes;
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const b of analysis.beats) {
        const x = (b.time / duration) * w;
        const th = 3 + b.strength * (laneBeats - 6);
        ctx.moveTo(x, yb);
        ctx.lineTo(x, yb + th);
      }
      ctx.stroke();
    }

    // Playhead
    const px = (currentTime / duration) * w;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();
  }

  // ---- editing interactions -----------------------------------------------------

  _pixelToTime(clientX) {
    const rect = this.canvas.getBoundingClientRect();
    const frac = (clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(1, frac)) * this._duration;
  }

  _hitTest(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    for (const hb of this._keyframeHitboxes) {
      const dx = x - hb.x, dy = y - hb.y;
      if (Math.sqrt(dx * dx + dy * dy) <= KEYFRAME_HIT_RADIUS_PX) {
        return { type: 'keyframe', keyframeId: hb.keyframeId };
      }
    }

    for (const hb of this._cueHitboxes) {
      if (y < hb.y0 - 2 || y > hb.y1 + 2 || x < hb.x0 - 2 || x > hb.x1 + 2) continue;
      if (Math.abs(x - hb.x0) <= EDGE_TOLERANCE_PX) return { type: 'cue', cueId: hb.cueId, part: 'left' };
      if (Math.abs(x - hb.x1) <= EDGE_TOLERANCE_PX) return { type: 'cue', cueId: hb.cueId, part: 'right' };
      return { type: 'cue', cueId: hb.cueId, part: 'body' };
    }
    return null;
  }

  /** Snaps a candidate time to 0, the song end, or another cue's/keyframe's edge within a small on-screen tolerance. */
  _snapTime(t, { excludeCueId, excludeKeyframeId } = {}) {
    const rect = this.canvas.getBoundingClientRect();
    const pxPerSec = rect.width / this._duration;
    const tolerance = SNAP_PX / pxPerSec;
    const candidates = [0, this._duration];
    for (const c of this._project.timeline || []) {
      if (c.id === excludeCueId) continue;
      candidates.push(c.startTime, c.endTime);
    }
    const fixture = this._selectedFixture();
    if (fixture) {
      for (const kf of fixture.keyframes || []) {
        if (kf.id === excludeKeyframeId) continue;
        candidates.push(kf.time);
      }
    }
    let best = t, bestDist = tolerance;
    for (const c of candidates) {
      const d = Math.abs(t - c);
      if (d < bestDist) { bestDist = d; best = c; }
    }
    return best;
  }

  _onPointerDown(e) {
    if (!this._duration) return;
    const hit = this._hitTest(e.clientX, e.clientY);
    if (hit?.type === 'keyframe') {
      const fixture = this._selectedFixture();
      const kf = fixture?.keyframes.find((k) => k.id === hit.keyframeId);
      if (!kf) return;
      this._drag = { mode: 'move-keyframe', keyframeId: hit.keyframeId, startClientX: e.clientX, origTime: kf.time, moved: false };
    } else if (hit?.type === 'cue') {
      const cue = (this._project.timeline || []).find((c) => c.id === hit.cueId);
      if (!cue) return;
      this._drag = {
        mode: hit.part === 'body' ? 'move' : hit.part === 'left' ? 'resize-left' : 'resize-right',
        cueId: hit.cueId,
        startClientX: e.clientX,
        origStart: cue.startTime,
        origEnd: cue.endTime,
        moved: false,
      };
    } else {
      this._drag = { mode: 'seek', moved: false };
    }
    this.canvas.setPointerCapture?.(e.pointerId);
  }

  _onPointerMove(e) {
    if (!this._drag || !this._duration) return;
    const dxPx = e.clientX - this._drag.startClientX;
    if (this._drag.mode === 'seek') {
      if (Math.abs(dxPx || 0) > MOVE_THRESHOLD_PX) this._drag.moved = true;
      return;
    }
    if (Math.abs(dxPx) > MOVE_THRESHOLD_PX) this._drag.moved = true;

    const rect = this.canvas.getBoundingClientRect();
    const dt = (dxPx / rect.width) * this._duration;

    if (this._drag.mode === 'move-keyframe') {
      const fixture = this._selectedFixture();
      const kf = fixture?.keyframes.find((k) => k.id === this._drag.keyframeId);
      if (!kf) return;
      let newTime = this._snapTime(this._drag.origTime + dt, { excludeKeyframeId: kf.id });
      kf.time = Math.max(0, Math.min(this._duration, newTime));
      this.onKeyframeChange?.(fixture.id, kf.id);
      return;
    }

    const cue = (this._project.timeline || []).find((c) => c.id === this._drag.cueId);
    if (!cue) return;

    if (this._drag.mode === 'resize-left') {
      let newStart = this._snapTime(this._drag.origStart + dt, { excludeCueId: cue.id });
      newStart = Math.max(0, Math.min(newStart, cue.endTime - MIN_CUE_DURATION));
      cue.startTime = newStart;
    } else if (this._drag.mode === 'resize-right') {
      let newEnd = this._snapTime(this._drag.origEnd + dt, { excludeCueId: cue.id });
      newEnd = Math.min(this._duration, Math.max(newEnd, cue.startTime + MIN_CUE_DURATION));
      cue.endTime = newEnd;
    } else if (this._drag.mode === 'move') {
      const span = this._drag.origEnd - this._drag.origStart;
      let newStart = this._snapTime(this._drag.origStart + dt, { excludeCueId: cue.id });
      newStart = Math.max(0, Math.min(this._duration - span, newStart));
      cue.startTime = newStart;
      cue.endTime = newStart + span;
    }
    this.onCueChange?.(cue.id, { startTime: cue.startTime, endTime: cue.endTime });
  }

  _onPointerUp(e) {
    if (!this._drag) return;
    const drag = this._drag;
    this._drag = null;

    if (drag.mode === 'move-keyframe') {
      const fixture = this._selectedFixture();
      if (fixture) fixture.keyframes.sort((a, b) => a.time - b.time);
      this.selectedKeyframeId = drag.keyframeId;
      this.onKeyframeSelect?.(drag.keyframeId);
      return;
    }

    if (drag.mode === 'seek' || !drag.moved) {
      const hit = this._hitTest(e.clientX, e.clientY);
      if (hit?.type === 'keyframe') {
        this.selectedKeyframeId = hit.keyframeId;
        this.onKeyframeSelect?.(hit.keyframeId);
        return;
      }
      this.selectedCueId = hit?.type === 'cue' ? hit.cueId : null;
      this.selectedKeyframeId = null;
      this.onCueSelect?.(this.selectedCueId);
      this.onKeyframeSelect?.(null);
      this.onSeek?.(this._pixelToTime(e.clientX));
    } else {
      this.selectedCueId = drag.cueId;
      this.selectedKeyframeId = null;
      this.onCueSelect?.(drag.cueId);
      this.onKeyframeSelect?.(null);
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
