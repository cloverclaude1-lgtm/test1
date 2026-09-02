import { AudioEngine } from './audio/AudioEngine.js';
import { LightingEngine } from './lighting/LightingEngine.js';
import { StageRenderer } from './stage/StageRenderer.js';
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
import { TimelineView, renderTimelineLegend } from './ui/Timeline.js';

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
        if (f) { f.position = pos; f.role = inferRole(pos); this._refreshProperties(); this._refreshGroups(); }
      };
      this._timeline = new TimelineView(document.getElementById('timeline-canvas'));
      this._timeline.onSeek = (t) => this._seek(t);
      renderTimelineLegend(document.getElementById('timeline-legend'));
      window.addEventListener('resize', () => { this._stageRenderer.resize(); this._timeline.resize(); });
      this._startRenderLoop();
    }

    this._populateStyleSelect();
    this._stageRenderer.resize();
    this._timeline.resize();
    this._refreshAll();

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
    document.getElementById('menu-new').addEventListener('click', async () => {
      if (await showConfirm('Start a new project? Unsaved changes will be lost.', { confirmLabel: 'Start New' })) {
        this.project = createDefaultProject();
        this.audioEngine.stop();
        this.lightingEngine = new LightingEngine();
        this.selectedFixtureId = null;
        this._refreshAll();
        showToast('New project started', { type: 'success' });
      }
    });

    document.getElementById('menu-save').addEventListener('click', () => {
      downloadProjectFile(this.project);
      showToast('Project file ready — check your downloads (or the new tab that opened on Safari)', { type: 'success', durationMs: 4000 });
    });

    const openInput = document.createElement('input');
    openInput.type = 'file';
    openInput.accept = '.json,application/json';
    openInput.className = 'visually-hidden-input';
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
      showToast(`Opened "${project.name || 'project'}"`, { type: 'success' });
      openInput.value = '';
    });

    const audioInput = document.createElement('input');
    audioInput.type = 'file';
    audioInput.accept = 'audio/*';
    audioInput.className = 'visually-hidden-input';
    document.body.appendChild(audioInput);
    document.getElementById('menu-import-audio').addEventListener('click', () => audioInput.click());
    audioInput.addEventListener('change', async () => {
      if (!audioInput.files[0]) return;
      await this.audioEngine.loadFromFile(audioInput.files[0]);
      this.project.audio = { fileName: this.audioEngine.fileName, dataUrl: this.audioEngine.audioDataUrl, analysis: this.audioEngine.analysis };
      this.project.timeline = [];
      this.lightingEngine.resetClock(0);
      this._refreshAll();
      showToast('Song imported and analyzed. Click "Generate Show" when ready.', { type: 'success', durationMs: 4000 });
      audioInput.value = '';
    });

    document.getElementById('menu-generate').addEventListener('click', () => {
      if (!this.project.audio) { showToast('Import a song first (Import Audio in the menu bar).', { type: 'error' }); return; }
      this._applyGeneratedShow(this.project.style);
      this._refreshAll();
      showToast(`Show generated — ${this.project.timeline.length} cues across the song`, { type: 'success' });
    });

    const advancedBtn = document.getElementById('menu-advanced-toggle');
    advancedBtn.addEventListener('click', () => {
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
    });

    document.getElementById('menu-help').addEventListener('click', () => openTutorial());

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

  _addFixture(type) {
    const n = this.project.fixtures.length;
    const angle = (n % 8) * (Math.PI / 4);
    const pos = { x: Math.cos(angle) * 5, y: 5.5, z: Math.sin(angle) * 2 - 1 };
    const fixture = createFixture(type, { position: pos });
    this.project.fixtures.push(fixture);
    this.selectedFixtureId = fixture.id;
    this._refreshFixtures();
    this._refreshProperties();
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
          this._refreshProperties();
        }
        this._refreshFixtures();
      },
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
