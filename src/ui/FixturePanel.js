const TYPE_ICON = { par: '🔴', spotlight: '🔦', movinghead: '💡', strobe: '⚡', ledstrip: '🎇' };

function colorToCss(c) {
  return `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`;
}

export function renderFixtureList(container, fixtures, selectedId, callbacks) {
  container.innerHTML = '';
  if (fixtures.length === 0) {
    container.innerHTML = '<div class="empty-hint">No fixtures yet — add one from the palette above.</div>';
    return;
  }
  for (const fixture of fixtures) {
    const row = document.createElement('div');
    row.className = 'fixture-row' + (fixture.id === selectedId ? ' selected' : '');

    const nameEl = document.createElement('div');
    nameEl.className = 'fixture-row-name';
    nameEl.innerHTML = `<span class="swatch" style="background:${colorToCss(fixture.baseColor)}"></span>${TYPE_ICON[fixture.type] || '💡'} ${escapeHtml(fixture.name)}`;
    nameEl.title = 'Click to select';
    nameEl.addEventListener('click', () => callbacks.onSelect(fixture.id));
    row.appendChild(nameEl);

    const actions = document.createElement('div');
    actions.className = 'fixture-row-actions';

    const toggleBtn = iconButton(fixture.enabled ? '👁' : '🚫', 'Enable/disable', () => callbacks.onToggleEnabled(fixture.id));
    const groupBtn = iconButton('🏷', 'Assign to groups', () => callbacks.onAssignGroups(fixture.id));
    const dupBtn = iconButton('⧉', 'Duplicate', () => callbacks.onDuplicate(fixture.id));
    const delBtn = iconButton('✕', 'Delete', () => callbacks.onDelete(fixture.id));
    actions.append(toggleBtn, groupBtn, dupBtn, delBtn);
    row.appendChild(actions);

    container.appendChild(row);
  }
}

function iconButton(label, title, onClick) {
  const b = document.createElement('button');
  b.className = 'icon-btn';
  b.textContent = label;
  b.title = title;
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
