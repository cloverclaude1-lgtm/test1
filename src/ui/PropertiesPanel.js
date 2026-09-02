import { fixtureCapabilities } from '../fixtures/Fixture.js';

// Same truss coordinate scheme as ProjectManager.js's defaultRig() — x/z only,
// so a fixture's current height (Y) is preserved when snapping it into place.
const QUICK_POSITION_SLOTS = {
  front: { x: 0, z: 2.5 },
  back: { x: 0, z: -4.5 },
  left: { x: -6.5, z: 2.5 },
  right: { x: 6.5, z: 2.5 },
  center: { x: 0, z: 0 },
};

function field(labelText, inputEl, valueDisplay) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const label = document.createElement('label');
  label.textContent = labelText;
  if (valueDisplay) {
    const span = document.createElement('span');
    span.textContent = valueDisplay;
    label.appendChild(span);
  }
  wrap.append(label, inputEl);
  return wrap;
}

function colorToHex(c) {
  const h = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}
function hexToColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/**
 * Renders the manual-override controls for the selected fixture (brief §20).
 * Each row has a checkbox: checked -> a manual value overrides the automatic
 * lighting; unchecked -> the field is deleted from fixture.override and the
 * engine's automatic output shows through again.
 */
export function renderProperties(container, fixture, callbacks) {
  container.innerHTML = '';
  if (!fixture) {
    container.innerHTML = '<div class="empty-hint">Select a fixture to edit its properties.</div>';
    return;
  }
  const caps = fixtureCapabilities(fixture);
  const override = fixture.override || {};

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = fixture.name;
  nameInput.addEventListener('change', () => callbacks.onChange({ name: nameInput.value }));
  container.appendChild(field('Name', nameInput));

  // Quick position: snaps the fixture to a preset slot on the matching truss and
  // updates its role in one click, instead of hand-editing X/Y/Z (brief ask: make
  // fixture assignment easier). Keeps the fixture's current height (Y) unchanged.
  const quickPosWrap = document.createElement('div');
  quickPosWrap.className = 'field';
  const quickPosLabel = document.createElement('label');
  quickPosLabel.innerHTML = `Quick position <span>role: ${fixture.role}</span>`;
  const quickPosRow = document.createElement('div');
  quickPosRow.className = 'quick-pos-row';
  for (const [roleLabel, slot] of Object.entries(QUICK_POSITION_SLOTS)) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost tiny';
    btn.textContent = roleLabel[0].toUpperCase() + roleLabel.slice(1);
    btn.addEventListener('click', () => {
      callbacks.onChange({ position: { ...fixture.position, x: slot.x, z: slot.z } });
    });
    quickPosRow.appendChild(btn);
  }
  quickPosWrap.append(quickPosLabel, quickPosRow);
  container.appendChild(quickPosWrap);

  // Position
  const posRow = document.createElement('div');
  posRow.className = 'field-row';
  ['x', 'y', 'z'].forEach((axis) => {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.1';
    input.value = fixture.position[axis];
    input.addEventListener('change', () => {
      callbacks.onChange({ position: { ...fixture.position, [axis]: parseFloat(input.value) || 0 } });
    });
    posRow.appendChild(field(axis.toUpperCase(), input));
  });
  container.appendChild(posRow);

  container.appendChild(overrideRow('Brightness', 'intensity', override, (v) => callbacks.onOverride('intensity', v), 'range', { min: 0, max: 1, step: 0.01 }));
  container.appendChild(overrideColorRow('Color', override, (v) => callbacks.onOverride('color', v)));

  if (caps.pan) container.appendChild(overrideRow('Pan', 'pan', override, (v) => callbacks.onOverride('pan', v), 'range', { min: -1, max: 1, step: 0.01 }));
  if (caps.tilt) container.appendChild(overrideRow('Tilt', 'tilt', override, (v) => callbacks.onOverride('tilt', v), 'range', { min: -1, max: 1, step: 0.01 }));
  if (caps.zoom) container.appendChild(overrideRow('Zoom', 'zoom', override, (v) => callbacks.onOverride('zoom', v), 'range', { min: 0, max: 1, step: 0.01 }));
  if (caps.strobe) container.appendChild(overrideRow('Strobe', 'strobe', override, (v) => callbacks.onOverride('strobe', v), 'range', { min: 0, max: 1, step: 0.01 }));

  container.appendChild(frequencyResponseSection(fixture, callbacks.onChange));

  const hint = document.createElement('div');
  hint.className = 'empty-hint';
  hint.style.marginTop = '4px';
  hint.textContent = 'Check a box to manually pin a value — uncheck to return it to the automatic show.';
  container.appendChild(hint);
}

/**
 * Optional per-fixture gate/modulation by a live frequency band — "this light
 * only turns on when there's bass," etc. — independent of (and layered before)
 * the manual override above. See LightingEngine.update()'s frequency-reactivity
 * pass for how this is applied each frame.
 */
function frequencyResponseSection(fixture, onChange) {
  const reactivity = fixture.audioReactivity || { band: 'none', mode: 'gate', threshold: 0.5 };
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const label = document.createElement('label');
  label.textContent = 'Frequency Response';
  wrap.appendChild(label);

  const row = document.createElement('div');
  row.className = 'field-row';

  const bandSelect = document.createElement('select');
  [['none', 'None'], ['bass', 'Bass'], ['mid', 'Mid'], ['treble', 'Treble']].forEach(([v, l]) => {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = l;
    if (v === reactivity.band) opt.selected = true;
    bandSelect.appendChild(opt);
  });
  bandSelect.addEventListener('change', () => onChange({ audioReactivity: { ...reactivity, band: bandSelect.value } }));
  row.appendChild(field('Band', bandSelect));

  const modeSelect = document.createElement('select');
  [['gate', 'On/Off (Gate)'], ['modulate', 'Brightness (Modulate)']].forEach(([v, l]) => {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = l;
    if (v === reactivity.mode) opt.selected = true;
    modeSelect.appendChild(opt);
  });
  modeSelect.disabled = reactivity.band === 'none';
  modeSelect.addEventListener('change', () => onChange({ audioReactivity: { ...reactivity, mode: modeSelect.value } }));
  row.appendChild(field('Mode', modeSelect));
  wrap.appendChild(row);

  if (reactivity.band !== 'none' && reactivity.mode === 'gate') {
    const thresholdInput = document.createElement('input');
    thresholdInput.type = 'range';
    thresholdInput.min = 0; thresholdInput.max = 1; thresholdInput.step = 0.01;
    thresholdInput.value = reactivity.threshold ?? 0.5;
    const thresholdField = field(`Threshold (${Math.round((reactivity.threshold ?? 0.5) * 100)}%)`, thresholdInput);
    thresholdInput.addEventListener('input', () => {
      thresholdField.querySelector('label').firstChild.textContent = `Threshold (${Math.round(thresholdInput.value * 100)}%)`;
      onChange({ audioReactivity: { ...reactivity, threshold: parseFloat(thresholdInput.value) } });
    });
    wrap.appendChild(thresholdField);
  }

  const hint = document.createElement('div');
  hint.className = 'empty-hint';
  hint.textContent = reactivity.band === 'none'
    ? 'Off by default — the fixture follows only the automatic show.'
    : reactivity.mode === 'gate'
      ? `Only lit while ${reactivity.band} is above the threshold.`
      : `Brightness continuously follows live ${reactivity.band} energy.`;
  wrap.appendChild(hint);

  return wrap;
}

function overrideRow(label, key, override, onSet, type, opts) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const labelEl = document.createElement('label');

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = override[key] != null;

  const input = document.createElement('input');
  input.type = type;
  Object.assign(input, opts);
  input.value = override[key] != null ? override[key] : (opts.min + opts.max) / 2;
  input.disabled = !checkbox.checked;

  const valueSpan = document.createElement('span');
  valueSpan.textContent = Number(input.value).toFixed(2);

  checkbox.addEventListener('change', () => {
    input.disabled = !checkbox.checked;
    onSet(checkbox.checked ? parseFloat(input.value) : null);
  });
  input.addEventListener('input', () => {
    valueSpan.textContent = Number(input.value).toFixed(2);
    if (checkbox.checked) onSet(parseFloat(input.value));
  });

  labelEl.append(`Manual ${label} `, checkbox, valueSpan);
  wrap.append(labelEl, input);
  return wrap;
}

function overrideColorRow(label, override, onSet) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const labelEl = document.createElement('label');

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = !!override.color;

  const input = document.createElement('input');
  input.type = 'color';
  input.value = override.color ? colorToHex(override.color) : '#ffffff';
  input.disabled = !checkbox.checked;

  checkbox.addEventListener('change', () => {
    input.disabled = !checkbox.checked;
    onSet(checkbox.checked ? hexToColor(input.value) : null);
  });
  input.addEventListener('input', () => {
    if (checkbox.checked) onSet(hexToColor(input.value));
  });

  labelEl.append(`Manual ${label} `, checkbox);
  wrap.append(labelEl, input);
  return wrap;
}
