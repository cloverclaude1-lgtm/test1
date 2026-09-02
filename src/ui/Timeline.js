// ---------------------------------------------------------------------------
// Timeline (brief §19) — an editable, editing-suite-style sequence track.
//
// Draws the energy envelope, beat ticks, and the scene-cue blocks that make up
// `project.timeline`, and lets the user rearrange that sequence directly:
//   - drag a scene from the Scene Library and drop it on the timeline to place it
//   - drag a cue's left/right edge to resize it (snaps to 0, the song's end, and
//     other cues' edges)
//   - drag a cue's body to move it
//   - click empty space to seek, same as before
// All of this just mutates `project.timeline` in place — LightingEngine reads
// that array fresh every frame either way, so no separate "apply" step exists.
// ---------------------------------------------------------------------------

export const SECTION_COLORS = {
  intro: '#3a6ea8', buildup: '#c98a2e', drop: '#e0348f', chorus: '#7c5cff', verse: '#34a891', outro: '#555b6e',
};

const EDGE_TOLERANCE_PX = 7;
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
  hint.textContent = '· click to seek · drag edges to resize · drag a scene here to place it';
  container.appendChild(hint);
}

function capitalize(s) { return s[0].toUpperCase() + s.slice(1); }

/** Same "first group's color" rule SceneList.js uses, so a cue matches its scene's swatch. */
function colorFromScene(scene) {
  const g = scene?.groups && Object.values(scene.groups)[0];
  if (!g) return null;
  return `rgb(${Math.round(g.color.r * 255)}, ${Math.round(g.color.g * 255)}, ${Math.round(g.color.b * 255)})`;
}

export class TimelineView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onSeek = null;
    this.onCueChange = null;    // (cueId, {startTime, endTime}) => void — called live during resize/move
    this.onCueSelect = null;    // (cueId | null) => void
    this.onSceneDropped = null; // (sceneId, time) => void

    this._project = null;
    this._duration = 0;
    this._cueHitboxes = []; // [{cueId, x0, x1, y0, y1}] rebuilt every draw()
    this.selectedCueId = null;
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
      return;
    }

    const analysis = project.audio?.analysis;
    const laneEnergy = h * 0.45;
    const laneScenes = h * 0.3;
    const laneBeats = h * 0.25;

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
    const y0 = laneEnergy + 4;
    const y1 = y0 + laneScenes - 6;
    this._cueHitboxes = [];
    for (const cue of project.timeline || []) {
      const x0 = (cue.startTime / duration) * w;
      const x1 = (cue.endTime / duration) * w;
      const scene = project.scenes?.[cue.sceneId];
      const fill = colorFromScene(scene) || SECTION_COLORS[cue.label] || '#555';
      const isSelected = cue.id === this.selectedCueId;

      ctx.fillStyle = fill;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x0, y0, Math.max(1, x1 - x0 - 1), laneScenes - 6);
      ctx.globalAlpha = 1;

      if (isSelected) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(x0 + 1, y0 + 1, Math.max(1, x1 - x0 - 3), laneScenes - 8);
      }

      const text = scene?.name || cue.label || '';
      if (x1 - x0 > 34 && text) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = '9.5px Inter, sans-serif';
        ctx.fillText(text, x0 + 4, y0 + laneScenes / 2 + 3);
      }

      this._cueHitboxes.push({ cueId: cue.id, x0, x1, y0, y1 });
    }

    // Beat ticks
    if (analysis) {
      const yb = laneEnergy + laneScenes;
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
    for (const hb of this._cueHitboxes) {
      if (y < hb.y0 - 2 || y > hb.y1 + 2 || x < hb.x0 - 2 || x > hb.x1 + 2) continue;
      if (Math.abs(x - hb.x0) <= EDGE_TOLERANCE_PX) return { cueId: hb.cueId, part: 'left' };
      if (Math.abs(x - hb.x1) <= EDGE_TOLERANCE_PX) return { cueId: hb.cueId, part: 'right' };
      return { cueId: hb.cueId, part: 'body' };
    }
    return null;
  }

  /** Snaps a candidate time to 0, the song end, or another cue's edge within a small on-screen tolerance. */
  _snapTime(t, excludeCueId) {
    const rect = this.canvas.getBoundingClientRect();
    const pxPerSec = rect.width / this._duration;
    const tolerance = SNAP_PX / pxPerSec;
    const candidates = [0, this._duration];
    for (const c of this._project.timeline || []) {
      if (c.id === excludeCueId) continue;
      candidates.push(c.startTime, c.endTime);
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
    if (hit) {
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
    const cue = (this._project.timeline || []).find((c) => c.id === this._drag.cueId);
    if (!cue) return;

    if (this._drag.mode === 'resize-left') {
      let newStart = this._snapTime(this._drag.origStart + dt, cue.id);
      newStart = Math.max(0, Math.min(newStart, cue.endTime - MIN_CUE_DURATION));
      cue.startTime = newStart;
    } else if (this._drag.mode === 'resize-right') {
      let newEnd = this._snapTime(this._drag.origEnd + dt, cue.id);
      newEnd = Math.min(this._duration, Math.max(newEnd, cue.startTime + MIN_CUE_DURATION));
      cue.endTime = newEnd;
    } else if (this._drag.mode === 'move') {
      const span = this._drag.origEnd - this._drag.origStart;
      let newStart = this._snapTime(this._drag.origStart + dt, cue.id);
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

    if (drag.mode === 'seek' || !drag.moved) {
      const hit = this._hitTest(e.clientX, e.clientY);
      this.selectedCueId = hit ? hit.cueId : null;
      this.onCueSelect?.(this.selectedCueId);
      this.onSeek?.(this._pixelToTime(e.clientX));
    } else {
      this.selectedCueId = drag.cueId;
      this.onCueSelect?.(drag.cueId);
    }
  }
}
