import { AudioEngine } from './audio/AudioEngine.js';
import { LightingEngine } from './lighting/LightingEngine.js';
import { StageRenderer } from './stage/StageRenderer.js';
import { generateShow } from './lighting/ShowGenerator.js';
import { STYLE_IDS, STYLES } from './lighting/stylePresets.js';
import { createFixture } from './fixtures/Fixture.js';
import {
  createDefaultProject, downloadProjectFile, readProjectFile,
} from './project/ProjectManager.js';
import { renderFixtureList } from './ui/FixturePanel.js';
import { renderProperties } from './ui/PropertiesPanel.js';
import { renderSceneList } from './ui/SceneList.js';
import { renderRuleList, openRuleModal } from './ui/RuleBuilder.js';
import { renderGroupList, openGroupModal } from './ui/GroupPanel.js';
import { TimelineView } from './ui/Timeline.js';

// Maps AudioAnalyzer's onProgress `stage` names to the checklist's pipeline order
// (see index.html #analysis-checklist data-order attributes).
const STAGE_ORDER = { decode: 0, freq: 1, beats: 2, sections: 3, done: 4 };

export class App {
  constructor() {
    this.project = createDefaultProject();
    this.audioEngine = new AudioEngine();
    this.lightingEngine = new LightingEngine();
    this.selectedFixtureId = null;
    this.selectedStyle = 'edm';
    this.advancedMode = false;

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
        if (f) { f.position = pos; this._refreshProperties(); }
      };
      this._timeline = new TimelineView(document.getElementById('timeline-canvas'));
      this._timeline.onSeek = (t) => this._seek(t);
      window.addEventListener('resize', () => { this._stageRenderer.resize(); this._timeline.resize(); });
      this._startRenderLoop();
    }

    this._populateStyleSelect();
    this._stageRenderer.resize();
    this._timeline.resize();
    this._refreshAll();
  }

  // =========================================================================
  // Editor shell (menubar, palette, transport)
  // =========================================================================
  _bindEditorShell() {
    document.getElementById('menu-new').addEventListener('click', () => {
      if (confirm('Start a new project? Unsaved changes will be lost.')) {
        this.project = createDefaultProject();
        this.audioEngine.stop();
        this.lightingEngine = new LightingEngine();
        this.selectedFixtureId = null;
        this._refreshAll();
      }
    });

    document.getElementById('menu-save').addEventListener('click', () => downloadProjectFile(this.project));

    const openInput = document.createElement('input');
    openInput.type = 'file';
    openInput.accept = '.json,application/json';
    openInput.hidden = true;
    document.body.appendChild(openInput);
    document.getElementById('menu-load').addEventListener('click', () => openInput.click());
    openInput.addEventListener('change', async () => {
      if (!openInput.files[0]) return;
      const project = await readProjectFile(openInput.files[0]);
      this.project = project;
      this.lightingEngine = new LightingEngine();
      this.selectedFixtureId = null;
      if (project.audio) {
        await this.audioEngine.restoreFromProject(project.audio.dataUrl, project.audio.fileName, project.audio.analysis);
      } else {
        this.audioEngine.stop();
      }
      this._enterEditor();
    });

    const audioInput = document.createElement('input');
    audioInput.type = 'file';
    audioInput.accept = 'audio/*';
    audioInput.hidden = true;
    document.body.appendChild(audioInput);
    document.getElementById('menu-import-audio').addEventListener('click', () => audioInput.click());
    audioInput.addEventListener('change', async () => {
      if (!audioInput.files[0]) return;
      await this.audioEngine.loadFromFile(audioInput.files[0]);
      this.project.audio = { fileName: this.audioEngine.fileName, dataUrl: this.audioEngine.audioDataUrl, analysis: this.audioEngine.analysis };
      this.project.timeline = [];
      this.lightingEngine.resetClock(0);
      this._refreshAll();
      alert('Song imported and analyzed. Click "Generate Show" when ready.');
    });

    document.getElementById('menu-generate').addEventListener('click', () => {
      if (!this.project.audio) { alert('Import a song first (File → Import Audio).'); return; }
      this._applyGeneratedShow(this.project.style);
      this._refreshAll();
    });

    document.getElementById('menu-advanced-toggle').addEventListener('click', () => {
      this.advancedMode = !this.advancedMode;
      document.getElementById('groups-section').classList.toggle('hidden', !this.advancedMode);
      document.getElementById('rules-section').classList.toggle('hidden', !this.advancedMode);
    });

    document.querySelectorAll('.palette-btn').forEach((btn) => {
      btn.addEventListener('click', () => this._addFixture(btn.dataset.type));
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
  }

  _populateStyleSelect() {
    const select = document.getElementById('style-select');
    select.innerHTML = STYLE_IDS.map((id) => `<option value="${id}">${STYLES[id].label}</option>`).join('');
    select.value = this.project.style;
    select.onchange = () => {
      this.project.style = select.value;
      if (this.project.audio) this._applyGeneratedShow(select.value);
      this._refreshAll();
    };
  }

  _applyGeneratedShow(styleId) {
    const analysis = this.project.audio?.analysis || this.audioEngine.analysis;
    const { scenes, timeline } = generateShow(analysis, styleId);
    // Keep the hand-authored scene library so users can still apply those manually,
    // and merge in the freshly generated cues/scenes for this style.
    this.project.scenes = { ...this.project.scenes, ...scenes };
    this.project.timeline = timeline;
    this.project.style = styleId;
    this.lightingEngine.clearSceneOverride();
    this.lightingEngine.resetClock(this.audioEngine.currentTime);
  }

  _seek(t) {
    this.audioEngine.seek(t);
    this.lightingEngine.resetClock(t);
  }

  _addFixture(type) {
    const n = this.project.fixtures.length;
    const angle = (n % 8) * (Math.PI / 4);
    const pos = { x: Math.cos(angle) * 5, y: 5.5, z: Math.sin(angle) * 2 - 1 };
    const fixture = createFixture(type, { position: pos });
    this.project.fixtures.push(fixture);
    this.selectedFixtureId = fixture.id;
    this._refreshFixtures();
  }

  selectFixture(id) {
    this.selectedFixtureId = id;
    this._stageRenderer.setSelected(id);
    this._refreshFixtures();
    this._refreshProperties();
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
        if (this.selectedFixtureId === id) this.selectedFixtureId = null;
        this._refreshFixtures();
        this._refreshProperties();
      },
    });
    this._stageRenderer?.syncFixtures(this.project.fixtures);
  }

  _refreshProperties() {
    const fixture = this.project.fixtures.find((f) => f.id === this.selectedFixtureId) || null;
    renderProperties(document.getElementById('properties-panel'), fixture, {
      onChange: (patch) => { Object.assign(fixture, patch); this._refreshFixtures(); },
      onOverride: (key, value) => {
        if (!fixture.override) fixture.override = {};
        if (value == null) delete fixture.override[key];
        else fixture.override[key] = value;
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
    renderGroupList(document.getElementById('group-list'), this.project.fixtures, this.project.customGroups);
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
    const tick = () => {
      const time = this.audioEngine.buffer ? this.audioEngine.currentTime : performance.now() / 1000;
      const states = this.lightingEngine.update(time, this.audioEngine.featureStream, this.project);
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
      requestAnimationFrame(tick);
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
