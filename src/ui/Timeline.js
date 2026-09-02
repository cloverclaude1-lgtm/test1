// ---------------------------------------------------------------------------
// Timeline (brief §19) — a simplified but functional view: energy envelope,
// beat ticks, and generated scene cues as colored blocks, with a playhead and
// click/drag-to-seek. Kept intentionally simple (no per-event dragging yet)
// but the data model (project.timeline) already supports richer editing
// later without changing this renderer's contract.
// ---------------------------------------------------------------------------

const SECTION_COLORS = {
  intro: '#3a6ea8', buildup: '#c98a2e', drop: '#e0348f', chorus: '#7c5cff', verse: '#34a891', outro: '#555b6e',
};

export class TimelineView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onSeek = null;
    canvas.addEventListener('click', (e) => {
      if (!this._duration) return;
      const rect = canvas.getBoundingClientRect();
      const frac = (e.clientX - rect.left) / rect.width;
      this.onSeek?.(Math.max(0, Math.min(1, frac)) * this._duration);
    });
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const { clientWidth, clientHeight } = this.canvas;
    this.canvas.width = clientWidth * dpr;
    this.canvas.height = clientHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(project, currentTime, duration) {
    this._duration = duration || 0;
    const { ctx, canvas } = this;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    if (!duration) {
      ctx.fillStyle = '#4a4e5c';
      ctx.font = '12px Inter, sans-serif';
      ctx.fillText('Import a song to see its timeline', 12, h / 2 + 4);
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

    // Scene cue blocks
    let y0 = laneEnergy + 4;
    for (const cue of project.timeline || []) {
      const x0 = (cue.startTime / duration) * w;
      const x1 = (cue.endTime / duration) * w;
      ctx.fillStyle = SECTION_COLORS[cue.label] || '#555';
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x0, y0, Math.max(1, x1 - x0 - 1), laneScenes - 6);
      ctx.globalAlpha = 1;
      if (x1 - x0 > 34) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = '9.5px Inter, sans-serif';
        ctx.fillText(cue.label, x0 + 4, y0 + laneScenes / 2 + 3);
      }
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
}
