import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STAGE_LAYOUTS } from './stageLayouts.js';

// ---------------------------------------------------------------------------
// StageRenderer
//
// Pure presentation layer: it knows nothing about audio or the lighting
// engine's internals. Each frame the app hands it a Map<fixtureId,
// FixtureState> (brief §8's output) and it draws fixtures, beams and an
// illuminated stage. Keeping this separate from LightingEngine is what the
// brief calls out explicitly in §3 ("lighting engine should NOT directly
// depend on the 3D renderer").
// ---------------------------------------------------------------------------

const GRID_SNAP = 0.25;
const DEFAULT_MAX_POLAR_ANGLE = Math.PI * 0.49;

// radiusTop lands at local Y=1 (the floor end, after the beam is oriented fixture->floor
// and stretched by `dist`); radiusBottom lands at local Y=0 (the fixture end, position.copy(worldPos)).
// So this must be WIDE at top / NARROW at bottom for a beam that's a tip at the fixture
// spreading wide onto the floor.
const unitBeamGeometry = new THREE.CylinderGeometry(1, 0.04, 1, 20, 1, true);
unitBeamGeometry.translate(0, 0.5, 0); // spans local Y 0..1 so scale.y == length

export class StageRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x030308);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = DEFAULT_MAX_POLAR_ANGLE;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 40;

    this.currentLayoutId = null;
    this._layoutObjects = []; // meshes/lights owned by the current layout — disposed on setLayout()
    this.previewMode = false;
    this._previewLights = null; // created lazily on first enable, reused after that
    this._preFogDensity = null;
    this._viewMode = '3d'; // '3d' | 'top' | 'front'
    this._preLockedView = null; // stashed camera pos/target while in 'top'/'front', restored on returning to '3d'
    this.setLayout('arena');

    this.fixtureVisuals = new Map(); // fixtureId -> { group, body, beam, light, kind, selectionRing, ledPixels? }
    this.selectedId = null;

    // Scratch objects reused every frame in render() to avoid per-fixture GC churn.
    this._tmpColor = new THREE.Color();
    this._tmpTarget = new THREE.Vector3();
    this._tmpDir = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);

    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._dragging = null; // fixtureId being dragged
    this._dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this.onFixtureClick = null; // (id|null) => void
    this.onFixtureMoved = null; // (id, {x,y,z}) => void

    canvas.addEventListener('pointerdown', this._onPointerDown.bind(this));
    canvas.addEventListener('pointermove', this._onPointerMove.bind(this));
    window.addEventListener('pointerup', this._onPointerUp.bind(this));

    // Without this, a lost WebGL context (more likely the longer/heavier a
    // session runs — memory pressure, GPU driver hiccups, tab backgrounding)
    // is PERMANENT: the canvas goes blank forever with no error and no way to
    // recover short of a full page reload. preventDefault() here is what
    // actually enables Three.js's automatic recovery on 'webglcontextrestored'
    // (it lazily re-uploads existing geometries/materials on the next render
    // call — our JS-side scene graph was never lost, only the GPU buffers).
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('LightStage: WebGL context lost — attempting automatic recovery.');
      this.onContextLost?.();
    }, false);
    canvas.addEventListener('webglcontextrestored', () => {
      console.warn('LightStage: WebGL context restored.');
      this.onContextRestored?.();
    }, false);
  }

  /**
   * Rebuilds the venue environment (floor/truss/backdrop/screen/ambient
   * lighting/fog/camera framing) from a named layout in `stageLayouts.js`, OR
   * from a plain config object with the same shape (a user-entered "Custom"
   * layout — stageLayouts.js's own comment already frames each layout as "a
   * plain config, not bespoke per-layout code," so this just accepts one
   * built ad hoc instead of only ones registered in STAGE_LAYOUTS). Disposes
   * whatever the previous layout owned first. Fixtures the user has placed
   * (`fixtureVisuals`) are never touched — switching venues re-stages the
   * same rig, it doesn't reset it.
   */
  setLayout(layoutIdOrConfig) {
    const isCustom = layoutIdOrConfig && typeof layoutIdOrConfig === 'object';
    const config = isCustom ? { ...STAGE_LAYOUTS.arena, ...layoutIdOrConfig } : (STAGE_LAYOUTS[layoutIdOrConfig] || STAGE_LAYOUTS.arena);
    this.currentLayoutId = isCustom ? 'custom' : (STAGE_LAYOUTS[layoutIdOrConfig] ? layoutIdOrConfig : 'arena');
    this._currentConfig = config; // kept for anything (e.g. setTopDown) that needs the resolved config, not just the id

    for (const obj of this._layoutObjects) {
      this.scene.remove(obj);
      obj.geometry?.dispose();
      obj.material?.dispose();
    }
    this._layoutObjects = [];

    this.scene.fog = new THREE.FogExp2(config.fogColor, config.fogDensity);

    const own = (obj) => { this.scene.add(obj); this._layoutObjects.push(obj); return obj; };

    own(new THREE.HemisphereLight(config.hemiSky, config.hemiGround, config.hemiIntensity));

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(config.width, config.depth, 1, 1),
      new THREE.MeshStandardMaterial({ color: config.floorColor, roughness: 0.55, metalness: 0.35 })
    );
    floor.rotation.x = -Math.PI / 2;
    own(floor);

    const grid = new THREE.GridHelper(Math.max(config.width, config.depth), 24, 0x2a2d3a, 0x15161d);
    grid.position.y = 0.01;
    own(grid);

    const centerRing = new THREE.Mesh(
      new THREE.RingGeometry(1.4, 1.55, 48),
      new THREE.MeshBasicMaterial({ color: 0x7c5cff, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
    );
    centerRing.rotation.x = -Math.PI / 2;
    centerRing.position.set(0, 0.02, 0.5);
    own(centerRing);

    // Backdrop / back wall
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(config.backdropWidth, config.backdropHeight),
      new THREE.MeshStandardMaterial({ color: config.backdropColor, roughness: 0.9 })
    );
    backdrop.position.set(0, config.backdropHeight / 2, -config.depth / 2 - 0.2);
    own(backdrop);

    // Optional screen (brief §11) — a dark panel above the backdrop centre
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(config.screenWidth, config.screenHeight),
      new THREE.MeshBasicMaterial({ color: 0x000000 })
    );
    screen.position.set(0, config.backdropHeight * 0.65, -config.depth / 2 + 0.05);
    own(screen);
    this.screenMesh = screen;

    // Simple truss frame
    const trussMat = new THREE.MeshStandardMaterial({ color: config.trussColor, roughness: 0.4, metalness: 0.8 });
    const trussY = config.trussY;
    const bar = (w, h, d, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), trussMat);
      m.position.set(x, y, z);
      return own(m);
    };
    bar(config.width - 2, 0.18, 0.18, 0, trussY, -config.depth / 2 + 1); // back truss
    bar(config.width - 2, 0.18, 0.18, 0, trussY, 2.5); // front (audience-facing) truss
    bar(0.18, trussY, 0.18, -(config.width / 2 - 1), trussY / 2, -config.depth / 2 + 1);
    bar(0.18, trussY, 0.18, (config.width / 2 - 1), trussY / 2, -config.depth / 2 + 1);
    bar(0.18, trussY, 0.18, -(config.width / 2 - 1), trussY / 2, 2.5);
    bar(0.18, trussY, 0.18, (config.width / 2 - 1), trussY / 2, 2.5);

    this.camera.position.set(config.camera.pos.x, config.camera.pos.y, config.camera.pos.z);
    this.controls.target.set(config.camera.target.x, config.camera.target.y, config.camera.target.z);
    this.controls.update();

    // setLayout() just rebuilt `this.scene.fog` from scratch — if Preview Mode was
    // active, re-apply it now so switching venues doesn't silently drop back to the
    // normal dim look out from under the user.
    if (this.previewMode) this.setPreviewMode(true);

    // A layout switch while a locked view is active would otherwise leave the
    // camera framed for the OLD venue's size — reapply so the new one frames correctly.
    this.setViewMode(this._viewMode);
  }

  /**
   * Switches between the free 3D view and two locked 2D-style reads on the
   * same scene — a lightweight "plot" (top) and "elevation" (front) view,
   * rather than a separate render path. Reuses the same camera/OrbitControls
   * the normal 3D view uses: entering 'top' or 'front' from '3d' stashes the
   * current position/target once, and returning to '3d' restores exactly
   * that — going directly between 'top' and 'front' doesn't re-stash, so the
   * original free-orbit pose survives however many times the user hops
   * between the two locked views.
   */
  setViewMode(mode) {
    if (this._viewMode === '3d' && mode !== '3d' && !this._preLockedView) {
      this._preLockedView = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
    }
    this._viewMode = mode;
    const config = this._currentConfig || STAGE_LAYOUTS.arena;

    // Damping smooths free orbiting, but it also means a drag that ends right as a
    // locked mode engages can leave residual momentum that only becomes visible once
    // the angle constraints loosen again later (e.g. back in '3d') — since a locked
    // view should read as rigid/precise anyway, damping is off for 'top'/'front' and
    // restored for '3d'.
    this.controls.enableDamping = mode === '3d';

    if (mode === 'top') {
      const dist = Math.max(config.width, config.depth) * 0.9;
      this.camera.position.set(0, dist, 0.01); // tiny z offset avoids the lookAt gimbal-lock straight down
      this.controls.target.set(0, 0, 0);
      this.controls.minPolarAngle = 0;
      this.controls.maxPolarAngle = 0;
      this.controls.minAzimuthAngle = -Infinity;
      this.controls.maxAzimuthAngle = Infinity;
    } else if (mode === 'front') {
      // Stage x runs [-width/2, width/2] (left/right); z runs [-depth/2, depth/2] with
      // positive z toward the audience (matches Fixture.js's inferRole() and the PDF
      // plot export) — so the camera sits on the +z side looking back along -z.
      const dist = Math.max(config.width, config.trussY * 2) * 1.1;
      const midY = config.trussY / 2;
      this.camera.position.set(0, midY, dist);
      this.controls.target.set(0, midY, 0);
      this.controls.minPolarAngle = Math.PI / 2;
      this.controls.maxPolarAngle = Math.PI / 2;
      this.controls.minAzimuthAngle = 0;
      this.controls.maxAzimuthAngle = 0;
    } else {
      if (this._preLockedView) {
        this.camera.position.copy(this._preLockedView.pos);
        this.controls.target.copy(this._preLockedView.target);
        this._preLockedView = null;
      }
      this.controls.minPolarAngle = 0;
      this.controls.maxPolarAngle = DEFAULT_MAX_POLAR_ANGLE;
      this.controls.minAzimuthAngle = -Infinity;
      this.controls.maxAzimuthAngle = Infinity;
    }
    this.controls.update();
  }

  /**
   * Toggles a bright, flat "work light" view so a user can see the truss, floor,
   * backdrop and every placed fixture clearly, regardless of what the current show
   * (or the idle no-show wash) has them lit to. Purely a viewing convenience — it
   * never touches FixtureState, the project, or the generated show.
   *
   * Extra scene lights + fading the fog alone turned out not to be enough: the
   * floor/backdrop/truss materials are deliberately near-black for the normal
   * moody show look, and near-black colors stay dark under a diffuse light no
   * matter how bright that light is (the material multiplies the light down to
   * almost nothing). So this also temporarily swaps those materials' base
   * colors to light neutral tones — restored exactly on disable — which is what
   * actually makes the environment and rig legible, not just "less black."
   */
  setPreviewMode(enabled) {
    this.previewMode = enabled;

    if (!this._previewLights) {
      const ambient = new THREE.AmbientLight(0xffffff, 0.75);
      const fill = new THREE.DirectionalLight(0xffffff, 0.6);
      fill.position.set(6, 12, 8);
      this._previewLights = [ambient, fill];
    }

    if (enabled) {
      for (const light of this._previewLights) this.scene.add(light);
      if (this.scene.fog) {
        // Always capture fresh: this runs either on a direct enable (fog is
        // currently at its normal density) or right after setLayout() rebuilds
        // fog from scratch for a new venue (also its normal density) — in both
        // cases `scene.fog.density` right now IS the correct value to restore
        // to later. Caching it only once would go stale across a layout switch.
        this._preFogDensity = this.scene.fog.density;
        this.scene.fog.density = this._preFogDensity * 0.12;
      }

      this._dimmedColors = new Map();
      for (const obj of this._layoutObjects) {
        if (obj !== this.screenMesh) this._brightenForPreview(obj, 0xb8bcc8);
      }
      for (const vis of this.fixtureVisuals.values()) this._brightenForPreview(vis.body, 0x555a6a);
    } else {
      for (const light of this._previewLights) this.scene.remove(light);
      if (this.scene.fog && this._preFogDensity != null) {
        this.scene.fog.density = this._preFogDensity;
        this._preFogDensity = null;
      }
      if (this._dimmedColors) {
        for (const [material, hex] of this._dimmedColors) material.color.setHex(hex);
        this._dimmedColors = null;
      }
    }
  }

  /** Records a mesh's current material color (keyed by material, restored on disable) and brightens it. */
  _brightenForPreview(mesh, hex) {
    if (!mesh?.material?.color || !this._dimmedColors) return;
    if (!this._dimmedColors.has(mesh.material)) this._dimmedColors.set(mesh.material, mesh.material.color.getHex());
    mesh.material.color.setHex(hex);
  }

  resize() {
    const { clientWidth, clientHeight } = this.canvas;
    if (clientWidth === 0 || clientHeight === 0) return;
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
  }

  /** Syncs the Three.js scene graph with the current fixture list (add/remove/reposition). */
  syncFixtures(fixtures) {
    const seen = new Set();
    for (const fixture of fixtures) {
      seen.add(fixture.id);
      let vis = this.fixtureVisuals.get(fixture.id);
      if (!vis) {
        vis = this._createFixtureVisual(fixture);
        this.fixtureVisuals.set(fixture.id, vis);
        // A fixture added while Preview Mode is already on should show up bright
        // immediately, not stay dark until the toggle is flipped off and back on.
        if (this.previewMode) this._brightenForPreview(vis.body, 0x555a6a);
      }
      vis.group.position.set(fixture.position.x, fixture.position.y, fixture.position.z);
      vis.fixture = fixture;
    }
    for (const [id, vis] of this.fixtureVisuals) {
      if (!seen.has(id)) {
        this._disposeFixtureVisual(vis);
        this.fixtureVisuals.delete(id);
      }
    }
  }

  /**
   * Fully removes one fixture's visuals from the scene and frees their GPU
   * resources. `beam`/`light`/`selectionRing` are added directly to `this.scene`
   * (not as children of `vis.group` — see `_createFixtureVisual`), so removing
   * only `vis.group` on delete would silently orphan them forever: still in the
   * scene graph, still shaded every frame, with no reference left to clean them
   * up later. Every add→duplicate→delete cycle leaked one extra PointLight plus
   * geometries/materials this way before this fix — a real, unbounded resource
   * leak that degrades a long editing session toward "frozen."
   */
  _disposeFixtureVisual(vis) {
    this.scene.remove(vis.group, vis.beam, vis.selectionRing);
    if (vis.light) this.scene.remove(vis.light);
    vis.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose();
        o.material?.dispose();
      }
    });
    vis.beam.material?.dispose(); // beam geometry is the shared `unitBeamGeometry` — never dispose that
    vis.selectionRing.geometry?.dispose();
    vis.selectionRing.material?.dispose();
  }

  _createFixtureVisual(fixture) {
    const group = new THREE.Group();
    group.userData.fixtureId = fixture.id;
    const bodyColor = 0x1c1e28;
    let body;
    if (fixture.type === 'ledstrip') {
      body = new THREE.Mesh(new THREE.BoxGeometry(fixture.params?.lengthMeters || 2, 0.08, 0.08), new THREE.MeshStandardMaterial({ color: bodyColor }));
    } else if (fixture.type === 'par' || fixture.type === 'strobe') {
      body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.28, 16), new THREE.MeshStandardMaterial({ color: bodyColor }));
    } else {
      body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.3), new THREE.MeshStandardMaterial({ color: bodyColor }));
    }
    body.userData.fixtureId = fixture.id;
    group.add(body);

    const lensColor = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), lensColor);
    lens.position.y = -0.16;
    lens.userData.fixtureId = fixture.id;
    group.add(lens);

    const beamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(unitBeamGeometry, beamMat);
    this.scene.add(beam); // beam positioned in world space independent of group rotation

    const light = fixture.type === 'ledstrip'
      ? null
      : new THREE.PointLight(0xffffff, 0, 10, 2);
    if (light) this.scene.add(light);

    const selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.4, 24),
      new THREE.MeshBasicMaterial({ color: 0x7c5cff, transparent: true, opacity: 0, side: THREE.DoubleSide })
    );
    selectionRing.rotation.x = -Math.PI / 2;
    this.scene.add(selectionRing);

    let ledPixels = null;
    if (fixture.type === 'ledstrip') {
      ledPixels = [];
      const count = fixture.params?.pixelCount || 12;
      const len = fixture.params?.lengthMeters || 2;
      for (let i = 0; i < count; i++) {
        const px = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        px.position.set((i / (count - 1) - 0.5) * len, 0.06, 0);
        group.add(px);
        ledPixels.push(px);
      }
    }

    this.scene.add(group);
    return { group, body, lens, beam, light, selectionRing, ledPixels, kind: fixture.type };
  }

  setSelected(id) {
    this.selectedId = id;
  }

  /** Main draw call. `states` is the Map<fixtureId, FixtureState> from LightingEngine. */
  render(states, time) {
    for (const [id, vis] of this.fixtureVisuals) {
      const fixture = vis.fixture;
      const state = states.get(id);
      if (!fixture || !state) continue;

      const caps = FIXTURE_CAPS[fixture.type] || FIXTURE_CAPS.par;
      const worldPos = vis.group.position;

      // Strobe: fast on/off gating purely for the render (engine value is unaffected).
      let displayIntensity = state.intensity;
      if (state.strobe > 0.03) {
        const rate = 4 + state.strobe * 22;
        const on = Math.floor(time * rate) % 2 === 0;
        displayIntensity *= on ? 1 : 0.05;
      }

      const color = this._tmpColor.setRGB(state.color.r, state.color.g, state.color.b);
      vis.body.material.emissive.copy(color).multiplyScalar(displayIntensity * 0.9);

      if (vis.lens && vis.lens.material) {
        vis.lens.material.color.copy(color);
        vis.lens.material.color.multiplyScalar(0.3 + displayIntensity * 0.9);
      }

      // Aim point: PAR/LED point straight down; movable fixtures sweep pan/tilt across the stage.
      const target = this._tmpTarget.set(worldPos.x, 0, worldPos.z);
      if (caps.pan) target.x += state.pan * 5;
      if (caps.tilt) target.z += -1 + state.tilt * 4;

      if (vis.light) {
        vis.light.color.copy(color);
        vis.light.intensity = caps.pan || caps.tilt ? displayIntensity * 3.2 : displayIntensity * 2.2;
        vis.light.position.set(target.x, 0.3, target.z);
      }

      const dir = this._tmpDir.subVectors(target, worldPos);
      const dist = Math.max(0.3, dir.length());
      dir.normalize();
      vis.beam.visible = displayIntensity > 0.02;
      if (vis.beam.visible) {
        vis.beam.position.copy(worldPos);
        vis.beam.quaternion.setFromUnitVectors(this._up, dir);
        const widen = 0.3 + (1 - state.zoom) * 1.6;
        vis.beam.scale.set(widen, dist, widen);
        vis.beam.material.color.copy(color);
        vis.beam.material.opacity = Math.min(0.45, displayIntensity * 0.4);
      } else {
        vis.beam.material.opacity = 0;
      }

      if (vis.ledPixels && state.pixels) {
        vis.ledPixels.forEach((px, i) => {
          const v = state.pixels[i] ?? 0;
          px.material.color.copy(color).multiplyScalar(0.2 + v * state.intensity);
        });
      }

      const isSelected = id === this.selectedId;
      vis.selectionRing.position.set(worldPos.x, 0.03, worldPos.z);
      vis.selectionRing.material.opacity = isSelected ? 0.7 : 0;
    }

    // Screen reflects the overall wash colour — cheap "video screen" ambience.
    if (this.screenMesh) {
      let r = 0, g = 0, b = 0, n = 0;
      for (const [, vis] of this.fixtureVisuals) {
        const s = states.get(vis.fixture?.id);
        if (!s) continue;
        r += s.color.r * s.intensity; g += s.color.g * s.intensity; b += s.color.b * s.intensity; n++;
      }
      if (n > 0) this.screenMesh.material.color.setRGB((r / n) * 0.5, (g / n) * 0.5, (b / n) * 0.5);
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // ---- selection / drag-to-move -------------------------------------------------
  _pickFixtureAt(event) {
    const rect = this.canvas.getBoundingClientRect();
    this._pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this._pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._pointer, this.camera);
    const meshes = [];
    for (const vis of this.fixtureVisuals.values()) vis.group.traverse((o) => { if (o.isMesh) meshes.push(o); });
    const hits = this._raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    let obj = hits[0].object;
    while (obj && !obj.userData.fixtureId) obj = obj.parent;
    return obj ? obj.userData.fixtureId : null;
  }

  _onPointerDown(event) {
    const id = this._pickFixtureAt(event);
    this.onFixtureClick?.(id);
    if (id) {
      this._dragging = id;
      this._dragPlane.constant = -this.fixtureVisuals.get(id).group.position.y;
      this.controls.enabled = false;
    }
  }

  _onPointerMove(event) {
    if (!this._dragging) return;
    const rect = this.canvas.getBoundingClientRect();
    this._pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this._pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._pointer, this.camera);
    const point = new THREE.Vector3();
    if (this._raycaster.ray.intersectPlane(this._dragPlane, point)) {
      const x = Math.round(point.x / GRID_SNAP) * GRID_SNAP;
      const z = Math.round(point.z / GRID_SNAP) * GRID_SNAP;
      const vis = this.fixtureVisuals.get(this._dragging);
      vis.group.position.x = x;
      vis.group.position.z = z;
      this.onFixtureMoved?.(this._dragging, { x, y: vis.group.position.y, z });
    }
  }

  _onPointerUp() {
    this._dragging = null;
    this.controls.enabled = true;
  }

  dispose() {
    this.renderer.dispose();
  }
}

const FIXTURE_CAPS = {
  par: { pan: false, tilt: false },
  spotlight: { pan: true, tilt: true },
  movinghead: { pan: true, tilt: true },
  strobe: { pan: false, tilt: false },
  ledstrip: { pan: false, tilt: false },
  movingheadwash: { pan: true, tilt: true },
  movingheadbeam: { pan: true, tilt: true },
  fresnel: { pan: false, tilt: false },
  profile: { pan: false, tilt: false },
  blinder: { pan: false, tilt: false },
  followspot: { pan: true, tilt: true },
  scanner: { pan: true, tilt: true },
  laser: { pan: true, tilt: true },
  cyclight: { pan: false, tilt: false },
  uplight: { pan: false, tilt: false },
  pinspot: { pan: false, tilt: false },
  striplight: { pan: false, tilt: false },
  hybrid: { pan: true, tilt: true },
};
