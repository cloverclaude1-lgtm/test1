import { AudioEngine } from './audio/AudioEngine.js';
import { LightingEngine } from './lighting/LightingEngine.js';
import { StageRenderer } from './stage/StageRenderer.js';
import { STAGE_LAYOUT_IDS, STAGE_LAYOUTS } from './stage/stageLayouts.js';
import { RIG_PRESET_IDS, RIG_PRESETS, applyRigPreset } from './project/rigPresets.js';
import { generateShow } from './lighting/ShowGenerator.js';
import { STYLE_IDS, STYLES } from './lighting/stylePresets.js';
import { createFixture, inferRole } from './fixtures/Fixture.js';
import { showToast, showConfirm } from './ui/Toast.js';
import { openTutorial } from './ui/Tutorial.js';
import {
  createDefaultProject, downloadProjectFile, readProjectFile,
} from './project/ProjectManager.js';
import { renderFixtureList } from './ui/FixturePanel.js';
import { renderProperties } from './ui/PropertiesPanel.js';
import { renderSceneList } from './ui/SceneList.js';
import { renderRuleList, openRuleModal } from './ui/RuleBuilder.js';
import { renderGroupList, openGroupModal, openAssignGroupsModal } from './ui/GroupPanel.js';
import { createCustomGroup } from './lighting/Groups.js';
import { TimelineView, renderTimelineLegend, MIN_CUE_DURATION } from './ui/Timeline.js';

// Maps AudioAnalyzer's onProgress `stage` names to the checklist's pipeline order
// (see index.html #analysis-checklist data-order attributes).
const STAGE_ORDER = { decode: 0, freq: 1, beats: 2, sections: 3, done: 4 };
const DEFAULT_DROPPED_CUE_DURATION = 8;
let nextCueId = 1;
function makeCueId() {
  return `cue_${Date.now().toString(36)}_${(nextCueId++).toString(36)}`;
}

/**
 * Wraps a menubar action so a failure is never silent. Before this, an unexpected
 * exception anywhere in a click handler (sync or async) just aborted that handler
 * with nothing visible to the user — indistinguishable from "the button doesn't
 * work." Every menubar control below goes through this so any future bug in one of
 * them shows up as a toast + console entry instead of a mysteriously dead button.
 */
function safeHandler(label, fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      console.error(`LightStage: "${label}" failed:`, err);
      showToast(`"${label}" hit an error — check the console for details.`, { type: 'error' });
    }
  };
}

export class App {
  constructor() {
    this.project = createDefaultProject();
    this.audioEngine = new AudioEngine();
    this.lightingEngine = new LightingEngine();
    this.selectedFixtureId = null;
    this.selectedStyle = 'edm';
    this.advancedMode = false;
    this._defaultReactivityBand = 'none';

    this._bindOnboarding();
    this._bindEditorShell();
    this._fpsSamples = [];
  }

  // =========================================================================
  // Onboarding
  // =========================================================================
  _bindOnboarding() {
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('file-input');
    const addBtn = document.getElementById('btn-add-song');
    const demoBtn = document.getElementById('btn-demo-song');
    const generateBtn = document.getElementById('btn-generate');
    const skipBtn = document.getElementById('btn-skip-onboarding');

    addBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) this._handleSongFile(fileInput.files[0]);
    });

    ['dragover', 'dragenter'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); }));
    dropzone.addEventListener('drop', (e) => {
      const file = e.dataTransfer.files[0];
      if (file) this._handleSongFile(file);
    });

    demoBtn.addEventListener('click', async () => {
      const res = await fetch('./demo-song.wav');
      const blob = await res.blob();
      this._handleSongFile(new File([blob], 'LightStage Demo.wav', { type: 'audio/wav' }));
    });

    document.querySelectorAll('.style-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.style-btn').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.selectedStyle = btn.dataset.style;
      });
    });
    document.querySelector(`.style-btn[data-style="${this.selectedStyle}"]`)?.classList.add('selected');

    generateBtn.addEventListener('click', () => this._generateFromOnboarding());
    skipBtn.addEventListener('click', () => this._enterEditor());
  }

  async _handleSongFile(file) {
    const checklist = document.getElementById('analysis-checklist');
    checklist.querySelectorAll('li').forEach((li) => li.classList.remove('done', 'active'));
    document.getElementById('song-info').classList.remove('hidden');
    document.getElementById('song-name').textContent = file.name;

    this.audioEngine.onAnalysisProgress = (progress, stage) => {
      const order = STAGE_ORDER[stage] ?? 0;
      checklist.querySelectorAll('li').forEach((li) => {
        const liOrder = parseInt(li.dataset.order, 10);
        if (liOrder < order) li.classList.add('done');
        else if (liOrder === order) li.classList.add('active');
      });
    };

    await this.audioEngine.loadFromFile(file);
    checklist.querySelectorAll('li').forEach((li) => li.classList.add('done'));
    document.getElementById('btn-generate').disabled = false;
  }

  async _generateFromOnboarding() {
    if (!this.audioEngine.analysis) return;
    this._applyGeneratedShow(this.selectedStyle);
    this.project.audio = {
      fileName: this.audioEngine.fileName,
      dataUrl: this.audioEngine.audioDataUrl,
      analysis: this.audioEngine.analysis,
    };
    this._enterEditor();
  }

  _enterEditor() {
    document.getElementById('onboarding').classList.add('hidden');
    document.getElementById('editor').classList.remove('hidden');

    if (!this._stageRenderer) {
      this._stageRenderer = new StageRenderer(document.getElementById('stage-canvas'));
      this._stageRenderer.onFixtureClick = (id) => this.selectFixture(id);
      this._stageRenderer.onFixtureMoved = (id, pos) => {
        const f = this.project.fixtures.find((x) => x.id === id);
        if (f) { f.position = pos; f.role = inferRole(pos); this._refreshProperties(); this._refreshGroups(); }
      };
      this._stageRenderer.onContextLost = () => showToast('Graphics context lost — recovering…', { type: 'error' });
      this._stageRenderer.onContextRestored = () => showToast('Graphics recovered.', { type: 'success' });
      this._timeline = new TimelineView(document.getElementById('timeline-canvas'));
      this._timeline.onSeek = (t) => this._seek(t);
      this._timeline.onCueSelect = (cueId) => this._refreshCueInspector(cueId);
      this._timeline.onCueChange = () => this._refreshCueInspector(this._timeline.selectedCueId, { liveEdit: true });
      this._timeline.onSceneDropped = (sceneId, time) => this._onSceneDropped(sceneId, time);
      this._timeline.onKeyframeSelect = (keyframeId) => this._refreshKeyframeInspector(keyframeId);
      this._timeline.onKeyframeChange = () => this._refreshKeyframeInspector(this._timeline.selectedKeyframeId, { liveEdit: true });
      renderTimelineLegend(document.getElementById('timeline-legend'));
      this._bindCueInspector();
      this._bindKeyframeInspector();
      window.addEventListener('resize', () => { this._stageRenderer.resize(); this._timeline.resize(); });
      this._startRenderLoop();
    }

    this._populateStyleSelect();
    this._populateStageLayoutSelect();
    this._populateRigPresetSelect();
    this._stageRenderer.setLayout(this.project.stageLayout || 'arena');
    this._stageRenderer.resize();
    this._timeline.resize();
    this._timeline.selectedFixtureId = this.selectedFixtureId;
    this._refreshAll();
    this._updateAddKeyframeButton();

    try {
      if (!localStorage.getItem('lightstage_seen_tutorial')) {
        localStorage.setItem('lightstage_seen_tutorial', '1');
        openTutorial();
      }
    } catch (e) {
      // localStorage can throw in privacy mode / restrictive embeds — the
      // tutorial just won't auto-open then; it's still reachable via Help.
    }
  }

  // =========================================================================
  // Editor shell (menubar, palette, transport)
  // =========================================================================
  _bindEditorShell() {
    document.getElementById('menu-new').addEventListener('click', safeHandler('New Project', async () => {
      if (await showConfirm('Start a new project? Unsaved changes will be lost.', { confirmLabel: 'Start New' })) {
        this.project = createDefaultProject();
        this.audioEngine.stop();
        this.lightingEngine = new LightingEngine();
        this.selectedFixtureId = null;
        if (this._timeline) { this._timeline.selectedFixtureId = null; this._timeline.clearKeyframeSelection(); }
        this._refreshCueInspector(null);
        this._refreshKeyframeInspector(null);
        this._refreshAll();
        this._updateAddKeyframeButton();
        showToast('New project started', { type: 'success' });
      }
    }));

    document.getElementById('menu-save').addEventListener('click', safeHandler('Save Project', () => {
      downloadProjectFile(this.project);
      showToast('Project file ready — check your downloads (or the new tab that opened on Safari)', { type: 'success', durationMs: 4000 });
    }));

    const openInput = document.createElement('input');
    openInput.type = 'file';
    openInput.accept = '.json,application/json';
    openInput.className = 'visually-hidden-input';
    document.body.appendChild(openInput);
    document.getElementById('menu-load').addEventListener('click', safeHandler('Open Project', () => openInput.click()));
    openInput.addEventListener('change', safeHandler('Open Project', async () => {
      if (!openInput.files[0]) return;
      const project = await readProjectFile(openInput.files[0]);
      this.project = project;
      this.lightingEngine = new LightingEngine();
      this.selectedFixtureId = null;
      this._timeline?.clearSelection();
      if (this._timeline) { this._timeline.selectedFixtureId = null; this._timeline.clearKeyframeSelection(); }
      this._refreshCueInspector(null);
      this._refreshKeyframeInspector(null);
      if (project.audio) {
        await this.audioEngine.restoreFromProject(project.audio.dataUrl, project.audio.fileName, project.audio.analysis);
      } else {
        this.audioEngine.stop();
      }
      this._enterEditor();
      showToast(`Opened "${project.name || 'project'}"`, { type: 'success' });
      openInput.value = '';
    }));

    const audioInput = document.createElement('input');
    audioInput.type = 'file';
    audioInput.accept = 'audio/*';
    audioInput.className = 'visually-hidden-input';
    document.body.appendChild(audioInput);
    document.getElementById('menu-import-audio').addEventListener('click', safeHandler('Import Audio', () => audioInput.click()));
    audioInput.addEventListener('change', safeHandler('Import Audio', async () => {
      if (!audioInput.files[0]) return;
      await this.audioEngine.loadFromFile(audioInput.files[0]);
      this.project.audio = { fileName: this.audioEngine.fileName, dataUrl: this.audioEngine.audioDataUrl, analysis: this.audioEngine.analysis };
      this.project.timeline = [];
      this.lightingEngine.resetClock(0);
      this._refreshAll();
      this._updateAddKeyframeButton();
      showToast('Song imported and analyzed. Click "Generate Show" when ready.', { type: 'success', durationMs: 4000 });
      audioInput.value = '';
    }));

    document.getElementById('menu-generate').addEventListener('click', safeHandler('Generate Show', async () => {
      if (!this.project.audio) { showToast('Import a song first (Import Audio in the menu bar).', { type: 'error' }); return; }
      if (this.project.timeline.length > 0) {
        const ok = await showConfirm(
          'This replaces your current timeline (including any hand-placed or resized cues) with a new automatically generated one. Continue?',
          { confirmLabel: 'Generate' },
        );
        if (!ok) return;
      }
      this._applyGeneratedShow(this.project.style);
      this._refreshCueInspector(null);
      this._refreshAll();
      showToast(`Show generated — ${this.project.timeline.length} cues across the song`, { type: 'success' });
    }));

    const advancedBtn = document.getElementById('menu-advanced-toggle');
    advancedBtn.addEventListener('click', safeHandler('Advanced', () => {
      this.advancedMode = !this.advancedMode;
      advancedBtn.classList.toggle('active', this.advancedMode);
      const groupsSection = document.getElementById('groups-section');
      const rulesSection = document.getElementById('rules-section');
      groupsSection.classList.toggle('hidden', !this.advancedMode);
      rulesSection.classList.toggle('hidden', !this.advancedMode);
      if (this.advancedMode) {
        groupsSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        rulesSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }));

    document.getElementById('menu-help').addEventListener('click', safeHandler('Help', () => openTutorial()));

    const previewBtn = document.getElementById('preview-mode-toggle');
    previewBtn.addEventListener('click', safeHandler('Preview Mode', () => {
      const enabled = !previewBtn.classList.contains('active');
      this._stageRenderer.setPreviewMode(enabled);
      // Only flip the visible state once setPreviewMode has actually succeeded —
      // if it threw, safeHandler's catch fires first and the button stays showing
      // its real (unchanged) state instead of lying about having turned on.
      previewBtn.classList.toggle('active', enabled);
    }));

    document.getElementById('default-reactivity-select').addEventListener('change', safeHandler('Frequency reactivity default', (e) => {
      this._defaultReactivityBand = e.target.value;
    }));

    document.querySelectorAll('.palette-btn').forEach((btn) => {
      btn.addEventListener('click', () => this._addFixture(btn.dataset.type));
    });

    document.getElementById('btn-apply-rig-preset').addEventListener('click', () => {
      const presetId = document.getElementById('rig-preset-select').value;
      const added = applyRigPreset(this.project, presetId);
      this._refreshFixtures();
      showToast(`Added ${added} fixture(s) from "${RIG_PRESETS[presetId].label}"`, { type: 'success' });
    });

    document.getElementById('btn-new-group').addEventListener('click', () => {
      openGroupModal(this.project.fixtures, (group) => {
        this.project.customGroups.push(group);
        this._refreshGroups();
      });
    });

    document.getElementById('btn-new-rule').addEventListener('click', () => {
      openRuleModal(null, this.project.customGroups, (rule) => {
        this.project.rules.push(rule);
        this._refreshRules();
      });
    });

    document.getElementById('btn-play').addEventListener('click', () => {
      if (!this.audioEngine.buffer) return;
      if (this.audioEngine.isPlaying) this.audioEngine.pause();
      else this.audioEngine.play();
      this._updatePlayButton();
    });
    document.getElementById('btn-stop').addEventListener('click', () => {
      this.audioEngine.stop();
      this.lightingEngine.resetClock(0);
      this._updatePlayButton();
    });

    document.getElementById('btn-add-keyframe').addEventListener('click', safeHandler('Add Keyframe', () => {
      this._addKeyframeForSelectedFixture();
    }));
  }

  _populateStyleSelect() {
    const select = document.getElementById('style-select');
    select.innerHTML = STYLE_IDS.map((id) => `<option value="${id}">${STYLES[id].label}</option>`).join('');
    select.value = this.project.style;
    select.onchange = () => {
      this.project.style = select.value;
      // Deliberately does NOT auto-regenerate: once the timeline can be hand-edited,
      // silently rebuilding it on every style pick would wipe out that work. Style
      // just becomes what "Generate Show" builds next time it's clicked.
      showToast(`Style set to ${STYLES[select.value].label} — click "Generate Show" to apply it`, { type: 'info' });
    };
  }

  _populateStageLayoutSelect() {
    const select = document.getElementById('stage-layout-select');
    select.innerHTML = STAGE_LAYOUT_IDS.map((id) => `<option value="${id}">${STAGE_LAYOUTS[id].label}</option>`).join('');
    select.value = this.project.stageLayout || 'arena';
    select.onchange = () => {
      this.project.stageLayout = select.value;
      this._stageRenderer.setLayout(select.value);
      showToast(`Stage set to ${STAGE_LAYOUTS[select.value].label}`, { type: 'success' });
    };
  }

  _populateRigPresetSelect() {
    const select = document.getElementById('rig-preset-select');
    select.innerHTML = RIG_PRESET_IDS.map((id) => `<option value="${id}">${RIG_PRESETS[id].label}</option>`).join('');
  }

  _applyGeneratedShow(styleId) {
    const analysis = this.project.audio?.analysis || this.audioEngine.analysis;
    // Drop the previous auto-generated scenes (whatever the old timeline referenced)
    // before merging in the new batch, so regenerating or switching styles doesn't
    // pile up duplicate "Style · section" entries in the Scenes list every time.
    const staleIds = new Set((this.project.timeline || []).map((cue) => cue.sceneId));
    const keptScenes = Object.fromEntries(Object.entries(this.project.scenes).filter(([id]) => !staleIds.has(id)));
    const { scenes, timeline } = generateShow(analysis, styleId);
    // Keep the hand-authored scene library so users can still apply those manually,
    // and merge in the freshly generated cues/scenes for this style.
    this.project.scenes = { ...keptScenes, ...scenes };
    this.project.timeline = timeline;
    this.project.style = styleId;
    this.lightingEngine.clearSceneOverride();
    this.lightingEngine.resetClock(this.audioEngine.currentTime);
  }

  _seek(t) {
    this.audioEngine.seek(t);
    this.lightingEngine.resetClock(t);
  }

  // =========================================================================
  // Editable timeline: dropping scenes onto it, and the Cue Inspector panel
  // =========================================================================
  _onSceneDropped(sceneId, time) {
    const scene = this.project.scenes[sceneId];
    const duration = this.audioEngine.duration;
    if (!scene || !duration) return;
    // If the drop point lands inside an existing cue, that cue gets truncated to
    // end exactly there — like inserting a clip mid-way through another one in an
    // editing suite — so the new cue never has to fight it for the same span.
    const containing = this.project.timeline.find((c) => c.startTime <= time && c.endTime > time);
    // Cap the new cue's length against whatever comes next so dropping several
    // scenes closer together than DEFAULT_DROPPED_CUE_DURATION apart doesn't bury
    // the later ones under the earlier one's (fixed 8s) span — a buried cue would
    // never become "active" during playback, which read as the show never
    // advancing past the first dropped scene.
    const nextCue = this.project.timeline
      .filter((c) => c !== containing && c.startTime >= time)
      .sort((a, b) => a.startTime - b.startTime)[0];
    const cap = Math.min(duration, nextCue ? nextCue.startTime : duration);
    const endTime = Math.min(cap, time + DEFAULT_DROPPED_CUE_DURATION);
    if (endTime - time < MIN_CUE_DURATION) {
      showToast('No room for a cue there — try dropping it somewhere with more space', { type: 'error' });
      return;
    }
    if (containing) {
      // Truncating it below the minimum duration would leave a sliver cue behind —
      // just drop it instead.
      if (time - containing.startTime < MIN_CUE_DURATION) {
        this.project.timeline = this.project.timeline.filter((c) => c !== containing);
      } else {
        containing.endTime = time;
      }
    }
    const cue = {
      id: makeCueId(),
      startTime: time,
      endTime,
      sceneId,
      label: scene.name,
      transitionType: scene.transition?.type || 'fade',
      transitionDuration: scene.transition?.duration ?? 1.5,
    };
    // Keep the timeline sorted by startTime — findActiveCue() relies on array order
    // to find the chronological "previous cue" for crossfade blending, and an
    // unsorted array (e.g. from unshifting new cues to the front) breaks that.
    this.project.timeline.push(cue);
    this.project.timeline.sort((a, b) => a.startTime - b.startTime);
    this._timeline.selectedCueId = cue.id;
    this._refreshCueInspector(cue.id);
    showToast(`Placed "${scene.name}" on the timeline`, { type: 'success' });
  }

  /** Bounds a cue's neighbors impose (the nearest non-overlapping cue on each side),
   * so typed Cue Inspector edits can't overlap them — mirrors Timeline.js's drag clamp. */
  _cueNeighborBounds(cue) {
    const others = this.project.timeline.filter((c) => c.id !== cue.id);
    const left = others.filter((c) => c.endTime <= cue.startTime).sort((a, b) => b.endTime - a.endTime)[0];
    const right = others.filter((c) => c.startTime >= cue.endTime).sort((a, b) => a.startTime - b.startTime)[0];
    return { minStart: left ? left.endTime : 0, maxEnd: right ? right.startTime : (this.audioEngine.duration || 0) };
  }

  _bindCueInspector() {
    document.getElementById('cue-start-input').addEventListener('change', (e) => {
      const cue = this._selectedCue();
      if (!cue) return;
      const duration = cue.endTime - cue.startTime;
      const { minStart, maxEnd } = this._cueNeighborBounds(cue);
      let newStart = Math.max(minStart, parseFloat(e.target.value) || 0);
      newStart = Math.max(minStart, Math.min(newStart, maxEnd - MIN_CUE_DURATION));
      cue.startTime = newStart;
      cue.endTime = Math.min(maxEnd, this.audioEngine.duration, cue.startTime + duration);
      this.project.timeline.sort((a, b) => a.startTime - b.startTime);
      this._refreshCueInspector(cue.id);
    });
    document.getElementById('cue-duration-input').addEventListener('change', (e) => {
      const cue = this._selectedCue();
      if (!cue) return;
      const { maxEnd } = this._cueNeighborBounds(cue);
      const newDuration = Math.max(MIN_CUE_DURATION, parseFloat(e.target.value) || MIN_CUE_DURATION);
      cue.endTime = Math.min(maxEnd, this.audioEngine.duration, cue.startTime + newDuration);
      this._refreshCueInspector(cue.id);
    });
    document.getElementById('cue-delete-btn').addEventListener('click', () => {
      const cue = this._selectedCue();
      if (!cue) return;
      this.project.timeline = this.project.timeline.filter((c) => c.id !== cue.id);
      this._timeline.clearSelection();
      this._refreshCueInspector(null);
      showToast('Cue deleted', { type: 'success' });
    });
    document.getElementById('cue-deselect-btn').addEventListener('click', () => {
      this._timeline.clearSelection();
      this._refreshCueInspector(null);
    });
  }

  _selectedCue() {
    const id = this._timeline?.selectedCueId;
    return id ? this.project.timeline.find((c) => c.id === id) || null : null;
  }

  _bindKeyframeInspector() {
    document.getElementById('keyframe-time-input').addEventListener('change', (e) => {
      const { fixture, kf } = this._selectedKeyframe();
      if (!fixture || !kf) return;
      kf.time = Math.max(0, Math.min(this.audioEngine.duration || 0, parseFloat(e.target.value) || 0));
      fixture.keyframes.sort((a, b) => a.time - b.time);
      this._refreshKeyframeInspector(kf.id);
    });
    document.getElementById('keyframe-delete-btn').addEventListener('click', () => {
      const { fixture, kf } = this._selectedKeyframe();
      if (!fixture || !kf) return;
      fixture.keyframes = fixture.keyframes.filter((k) => k.id !== kf.id);
      this._timeline.clearKeyframeSelection();
      this._refreshKeyframeInspector(null);
      this._refreshProperties();
      showToast('Keyframe deleted', { type: 'success' });
    });
    document.getElementById('keyframe-deselect-btn').addEventListener('click', () => {
      this._timeline.clearKeyframeSelection();
      this._refreshKeyframeInspector(null);
    });
  }

  _selectedKeyframe() {
    const fixtureId = this._timeline?.selectedFixtureId;
    const keyframeId = this._timeline?.selectedKeyframeId;
    const fixture = fixtureId ? this.project.fixtures.find((f) => f.id === fixtureId) : null;
    const kf = fixture && keyframeId ? fixture.keyframes.find((k) => k.id === keyframeId) : null;
    return { fixture: fixture || null, kf: kf || null };
  }

  _refreshKeyframeInspector(keyframeId, { liveEdit = false } = {}) {
    if (this._timeline) this._timeline.selectedKeyframeId = keyframeId;
    const inspector = document.getElementById('keyframe-inspector');
    const legend = document.getElementById('timeline-legend');
    const { fixture, kf } = this._selectedKeyframe();

    if (!kf) {
      inspector.classList.add('hidden');
      if (!this._selectedCue()) legend.classList.remove('hidden');
      return;
    }
    inspector.classList.remove('hidden');
    legend.classList.add('hidden');

    document.getElementById('keyframe-inspector-name').textContent = `🔑 ${fixture.name}`;
    if (!liveEdit || document.activeElement?.id !== 'keyframe-time-input') {
      document.getElementById('keyframe-time-input').value = kf.time.toFixed(2);
    }
  }

  _refreshCueInspector(cueId, { liveEdit = false } = {}) {
    if (this._timeline) this._timeline.selectedCueId = cueId;
    const inspector = document.getElementById('cue-inspector');
    const legend = document.getElementById('timeline-legend');
    const cue = cueId ? this.project.timeline.find((c) => c.id === cueId) : null;

    if (!cue) {
      inspector.classList.add('hidden');
      if (!this._selectedKeyframe().kf) legend.classList.remove('hidden');
      return;
    }
    inspector.classList.remove('hidden');
    legend.classList.add('hidden');

    const scene = this.project.scenes[cue.sceneId];
    document.getElementById('cue-inspector-name').textContent = scene?.name || cue.label || 'Cue';
    // Don't fight the user's cursor mid-drag by rewriting the input they might be
    // focused in — only the numbers themselves update live during a drag/resize.
    if (!liveEdit || document.activeElement?.id !== 'cue-start-input') {
      document.getElementById('cue-start-input').value = cue.startTime.toFixed(1);
    }
    if (!liveEdit || document.activeElement?.id !== 'cue-duration-input') {
      document.getElementById('cue-duration-input').value = (cue.endTime - cue.startTime).toFixed(1);
    }
  }

  _addFixture(type) {
    const n = this.project.fixtures.length;
    const angle = (n % 8) * (Math.PI / 4);
    const pos = { x: Math.cos(angle) * 5, y: 5.5, z: Math.sin(angle) * 2 - 1 };
    const fixture = createFixture(type, { position: pos, audioReactivity: { band: this._defaultReactivityBand } });
    this.project.fixtures.push(fixture);
    this.selectedFixtureId = fixture.id;
    this._refreshFixtures();
    this._refreshProperties();
  }

  selectFixture(id) {
    this.selectedFixtureId = id;
    this._stageRenderer.setSelected(id);
    if (this._timeline) {
      this._timeline.selectedFixtureId = id;
      this._timeline.clearKeyframeSelection();
    }
    this._refreshKeyframeInspector(null);
    this._updateAddKeyframeButton();
    this._refreshFixtures();
    this._refreshProperties();
  }

  _updateAddKeyframeButton() {
    const btn = document.getElementById('btn-add-keyframe');
    if (!btn) return;
    const hasFixture = !!this.selectedFixtureId;
    const hasSong = !!this.audioEngine.buffer;
    btn.disabled = !(hasFixture && hasSong);
    btn.title = !hasFixture
      ? 'Select a fixture to add a keyframe'
      : !hasSong
        ? 'Import a song first'
        : 'Capture this fixture\'s current look as a keyframe at the playhead';
  }

  _addKeyframeForSelectedFixture() {
    const fixture = this.project.fixtures.find((f) => f.id === this.selectedFixtureId);
    if (!fixture) { showToast('Select a fixture first', { type: 'error' }); return; }
    if (!this.audioEngine.buffer) { showToast('Import a song first', { type: 'error' }); return; }
    const live = this._lastComputedStates?.get(fixture.id);
    if (!live) { showToast('Nothing to capture yet — try again in a moment', { type: 'error' }); return; }
    const time = this.audioEngine.currentTime;
    const state = {
      intensity: live.intensity,
      color: { ...live.color },
      pan: live.pan,
      tilt: live.tilt,
      zoom: live.zoom,
      strobe: live.strobe,
    };
    // Editing a keyframe already at (roughly) this instant updates it in place instead
    // of stacking a near-duplicate right next to it.
    const existing = fixture.keyframes.find((kf) => Math.abs(kf.time - time) < 0.05);
    let kf;
    if (existing) {
      existing.state = state;
      kf = existing;
    } else {
      kf = { id: `kf_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4).toString(36)}`, time, state };
      fixture.keyframes.push(kf);
    }
    fixture.keyframes.sort((a, b) => a.time - b.time);
    this._timeline.selectedFixtureId = fixture.id;
    this._timeline.selectedKeyframeId = kf.id;
    this._refreshKeyframeInspector(kf.id);
    this._refreshProperties();
    showToast(existing ? 'Keyframe updated' : 'Keyframe added', { type: 'success' });
  }

  // =========================================================================
  // Refresh / render helpers
  // =========================================================================
  _refreshAll() {
    this._refreshFixtures();
    this._refreshProperties();
    this._refreshScenes();
    this._refreshGroups();
    this._refreshRules();
    this._updatePlayButton();
  }

  _refreshFixtures() {
    renderFixtureList(document.getElementById('fixture-list'), this.project.fixtures, this.selectedFixtureId, {
      onSelect: (id) => this.selectFixture(id),
      onToggleEnabled: (id) => {
        const f = this.project.fixtures.find((x) => x.id === id);
        f.enabled = !f.enabled;
        this._refreshFixtures();
      },
      onDuplicate: (id) => {
        const f = this.project.fixtures.find((x) => x.id === id);
        const copy = createFixture(f.type, { position: { x: f.position.x + 0.5, y: f.position.y, z: f.position.z + 0.5 }, name: f.name + ' copy' });
        copy.params = { ...f.params };
        this.project.fixtures.push(copy);
        this._refreshFixtures();
      },
      onDelete: (id) => {
        this.project.fixtures = this.project.fixtures.filter((x) => x.id !== id);
        if (this.selectedFixtureId === id) {
          this.selectedFixtureId = null;
          if (this._timeline) { this._timeline.selectedFixtureId = null; this._timeline.clearKeyframeSelection(); }
          this._refreshKeyframeInspector(null);
          this._updateAddKeyframeButton();
        }
        this._refreshFixtures();
        this._refreshProperties();
      },
      onAssignGroups: (id) => {
        const fixture = this.project.fixtures.find((x) => x.id === id);
        openAssignGroupsModal(fixture, this.project.customGroups, {
          onToggle: (groupId, checked) => {
            const group = this.project.customGroups.find((g) => g.id === groupId);
            if (!group) return;
            if (checked && !group.fixtureIds.includes(id)) group.fixtureIds.push(id);
            else if (!checked) group.fixtureIds = group.fixtureIds.filter((fid) => fid !== id);
            this._refreshGroups();
          },
          onCreateGroup: (name) => {
            this.project.customGroups.push(createCustomGroup(name, [id]));
            this._refreshGroups();
            showToast(`Group "${name}" created`, { type: 'success' });
          },
        });
      },
    });
    this._stageRenderer?.syncFixtures(this.project.fixtures);
  }

  _refreshProperties() {
    const fixture = this.project.fixtures.find((f) => f.id === this.selectedFixtureId) || null;
    renderProperties(document.getElementById('properties-panel'), fixture, {
      onChange: (patch) => {
        Object.assign(fixture, patch);
        if (patch.position) {
          fixture.role = inferRole(fixture.position);
          this._refreshGroups();
        }
        if (patch.position || patch.audioReactivity) this._refreshProperties();
        this._refreshFixtures();
      },
      onOverride: (key, value) => {
        if (!fixture.override) fixture.override = {};
        if (value == null) delete fixture.override[key];
        else fixture.override[key] = value;
      },
      onClearKeyframes: () => {
        fixture.keyframes = [];
        if (this._timeline?.selectedFixtureId === fixture.id) this._timeline.clearKeyframeSelection();
        this._refreshKeyframeInspector(null);
        this._refreshProperties();
        showToast('Keyframes cleared — fixture returned to the automatic show', { type: 'success' });
      },
    });
  }

  _refreshScenes() {
    renderSceneList(
      document.getElementById('scene-list'),
      this.project.scenes,
      this.lightingEngine.manualSceneOverride?.sceneId || null,
      (sceneId) => { this.lightingEngine.manualSceneOverride = { sceneId }; this._refreshScenes(); },
      () => { this.lightingEngine.clearSceneOverride(); this._refreshScenes(); },
    );
  }

  _refreshGroups() {
    renderGroupList(document.getElementById('group-list'), this.project.fixtures, this.project.customGroups, {
      onEdit: (groupId) => {
        const group = this.project.customGroups.find((g) => g.id === groupId);
        openGroupModal(this.project.fixtures, (updated) => {
          const i = this.project.customGroups.findIndex((g) => g.id === updated.id);
          this.project.customGroups[i] = updated;
          this._refreshGroups();
        }, group);
      },
      onDelete: (groupId) => {
        this.project.customGroups = this.project.customGroups.filter((g) => g.id !== groupId);
        this._refreshGroups();
      },
    });
  }

  _refreshRules() {
    renderRuleList(document.getElementById('rule-list'), this.project.rules, {
      onToggle: (id) => { const r = this.project.rules.find((x) => x.id === id); r.enabled = !r.enabled; this._refreshRules(); },
      onEdit: (rule) => openRuleModal(rule, this.project.customGroups, (updated) => {
        const i = this.project.rules.findIndex((x) => x.id === updated.id);
        this.project.rules[i] = updated;
        this._refreshRules();
      }),
      onDelete: (id) => { this.project.rules = this.project.rules.filter((x) => x.id !== id); this._refreshRules(); },
    });
  }

  _updatePlayButton() {
    document.getElementById('btn-play').textContent = this.audioEngine.isPlaying ? '⏸' : '▶';
  }

  _startRenderLoop() {
    let lastFpsT = performance.now();
    let frames = 0;
    let lastErrorToastAt = 0;

    // Safety net: this loop must NEVER die. Before this fix, any exception thrown
    // anywhere in update()/render()/draw() (e.g. from a fixture/scene/rule with an
    // unexpected shape, most likely from an older/hand-edited saved project) would
    // propagate out of `tick()` and — since `requestAnimationFrame(tick)` was the
    // last statement — silently stop the whole render loop forever: the stage,
    // timeline and time display would freeze mid-frame while the DOM (and its
    // buttons) stayed technically alive, which reads exactly like "the app froze
    // and nothing I click does anything." Catching here means a single bad frame
    // is skipped and logged instead of killing the app; the next frame gets a
    // fresh chance (and most of these bugs are now fixed at the source too, see
    // the guards added in LightingEngine/StageRenderer/Groups/RuleEngine).
    const tick = () => {
      try {
        const time = this.audioEngine.buffer ? this.audioEngine.currentTime : performance.now() / 1000;
        const states = this.lightingEngine.update(time, this.audioEngine.featureStream, this.project);
        this._lastComputedStates = states;
        this._stageRenderer.render(states, time);
        this._timeline.draw(this.project, time, this.audioEngine.duration);

        const dur = this.audioEngine.duration;
        document.getElementById('time-display').textContent = `${fmtTime(time)} / ${fmtTime(dur)}`;
        if (this.audioEngine.isPlaying && dur && time >= dur - 0.05) this._updatePlayButton();

        frames++;
        const now = performance.now();
        if (now - lastFpsT > 500) {
          document.getElementById('fps-counter').textContent = `${Math.round((frames * 1000) / (now - lastFpsT))} fps`;
          frames = 0;
          lastFpsT = now;
        }
      } catch (err) {
        console.error('LightStage render loop error (frame skipped, loop continues):', err);
        const now = performance.now();
        if (now - lastErrorToastAt > 5000) {
          lastErrorToastAt = now;
          showToast('A rendering hiccup was recovered — check the console for details.', { type: 'error' });
        }
      } finally {
        requestAnimationFrame(tick);
      }
    };
    this.audioEngine.onEnded = () => this._updatePlayButton();
    requestAnimationFrame(tick);
  }
}

function fmtTime(t) {
  if (!isFinite(t)) return '00:00';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
