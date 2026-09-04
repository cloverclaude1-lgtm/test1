import { saveVersion, listVersions, deleteVersion, diffVersions } from '../project/VersionStore.js';

function fmtDate(ts) {
  return new Date(ts).toLocaleString();
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Opens the Version History modal for `project` (the live current project —
 * only read from, to build a snapshot when "Save Current as Version" is
 * clicked). `callbacks.onRestore(record)` must return a Promise<boolean>:
 * resolve `true` once it has actually swapped in the restored project (the
 * modal then closes itself), or `false` if the user cancelled a confirmation
 * (the modal stays open).
 */
export function openVersionHistoryModal(project, callbacks) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal version-modal';
  modal.innerHTML = '<h3>Version History</h3>';

  const saveRow = document.createElement('div');
  saveRow.className = 'field-row';
  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.placeholder = 'e.g. "Chicago — load-in" (optional)';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary small';
  saveBtn.style.width = 'auto';
  saveBtn.textContent = 'Save Current as Version';
  saveRow.append(labelInput, saveBtn);
  modal.appendChild(saveRow);

  const list = document.createElement('div');
  list.className = 'version-list';
  modal.appendChild(list);

  const compareBar = document.createElement('div');
  compareBar.className = 'version-compare-bar hidden';
  const compareBtn = document.createElement('button');
  compareBtn.className = 'btn btn-ghost tiny';
  compareBtn.style.width = 'auto';
  compareBtn.textContent = 'Compare Selected (2)';
  compareBar.appendChild(compareBtn);
  modal.appendChild(compareBar);

  const diffOutput = document.createElement('div');
  diffOutput.className = 'version-diff hidden';
  modal.appendChild(diffOutput);

  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const close = document.createElement('button');
  close.className = 'btn btn-ghost';
  close.textContent = 'Close';
  close.addEventListener('click', () => backdrop.remove());
  actions.appendChild(close);
  modal.appendChild(actions);

  let selected = []; // up to 2 version ids, for Compare

  async function refresh() {
    const versions = await listVersions();
    list.innerHTML = '';
    if (versions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-hint';
      empty.textContent = 'No saved versions yet — save the current project state above to start a history.';
      list.appendChild(empty);
    }
    for (const v of versions) {
      const row = document.createElement('div');
      row.className = 'version-row';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.title = 'Select to compare (up to 2)';
      cb.checked = selected.includes(v.id);
      cb.addEventListener('change', () => {
        if (cb.checked) {
          if (selected.length >= 2) { cb.checked = false; return; }
          selected.push(v.id);
        } else {
          selected = selected.filter((id) => id !== v.id);
        }
        compareBar.classList.toggle('hidden', selected.length !== 2);
        diffOutput.classList.add('hidden');
      });

      const info = document.createElement('div');
      info.className = 'version-row-info';
      const labelEl = document.createElement('div');
      labelEl.className = 'version-row-label';
      labelEl.textContent = v.label;
      const metaEl = document.createElement('div');
      metaEl.className = 'hint';
      metaEl.textContent = `${fmtDate(v.createdAt)} · ${v.meta.fixtureCount} fixtures · ${v.meta.sceneCount} scenes · ${v.meta.cueCount} cues`;
      info.append(labelEl, metaEl);

      const rowActions = document.createElement('div');
      rowActions.className = 'version-row-actions';
      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'btn btn-ghost tiny';
      restoreBtn.style.width = 'auto';
      restoreBtn.textContent = 'Restore';
      restoreBtn.addEventListener('click', async () => {
        const done = await callbacks.onRestore(v);
        if (done) backdrop.remove();
      });
      const delBtn = document.createElement('button');
      delBtn.className = 'icon-btn';
      delBtn.textContent = '✕';
      delBtn.title = 'Delete version';
      delBtn.addEventListener('click', async () => {
        await deleteVersion(v.id);
        selected = selected.filter((id) => id !== v.id);
        compareBar.classList.toggle('hidden', selected.length !== 2);
        refresh();
      });
      rowActions.append(restoreBtn, delBtn);

      row.append(cb, info, rowActions);
      list.appendChild(row);
    }
  }

  saveBtn.addEventListener('click', async () => {
    await saveVersion(project, labelInput.value);
    labelInput.value = '';
    refresh();
  });

  compareBtn.addEventListener('click', async () => {
    const versions = await listVersions();
    const a = versions.find((v) => v.id === selected[0]);
    const b = versions.find((v) => v.id === selected[1]);
    if (!a || !b) return;
    const [older, newer] = a.createdAt <= b.createdAt ? [a, b] : [b, a]; // read naturally oldest → newest
    const lines = diffVersions(older, newer);
    diffOutput.innerHTML = `<div class="hint">${escapeHtml(older.label)} → ${escapeHtml(newer.label)}</div>`
      + lines.map((l) => `<div>${escapeHtml(l)}</div>`).join('');
    diffOutput.classList.remove('hidden');
  });

  refresh();
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
}
