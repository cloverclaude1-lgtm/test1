export function renderSceneList(container, scenes, activeOverrideId, onApply, onClear) {
  container.innerHTML = '';
  const list = Object.values(scenes);
  if (list.length === 0) {
    container.innerHTML = '<div class="empty-hint">No scenes yet.</div>';
    return;
  }

  if (activeOverrideId) {
    const clearRow = document.createElement('button');
    clearRow.className = 'btn btn-ghost tiny';
    clearRow.textContent = '↺ Back to automatic show';
    clearRow.addEventListener('click', onClear);
    container.appendChild(clearRow);
  }

  for (const scene of list) {
    const row = document.createElement('div');
    row.className = 'scene-row' + (scene.id === activeOverrideId ? ' active' : '');
    row.style.cursor = 'grab';
    row.title = 'Click to preview live, or drag onto the timeline to place it';
    row.draggable = true;
    const swatch = swatchFromScene(scene);
    row.innerHTML = `<span>${swatch} ${escapeHtml(scene.name)}</span>`;
    row.addEventListener('click', () => onApply(scene.id));
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', scene.id);
      e.dataTransfer.effectAllowed = 'copy';
    });
    container.appendChild(row);
  }
}

function swatchFromScene(scene) {
  const g = Object.values(scene.groups)[0];
  if (!g) return '⬤';
  const c = g.color;
  const hex = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
  return `<span class="swatch" style="background:${hex}"></span>`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
