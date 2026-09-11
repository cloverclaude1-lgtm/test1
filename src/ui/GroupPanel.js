import { listAllGroups, createCustomGroup, resolveGroup } from '../lighting/Groups.js';

export function renderGroupList(container, fixtures, customGroups, callbacks = {}) {
  container.innerHTML = '';
  const groups = listAllGroups(customGroups);
  for (const g of groups) {
    const count = resolveGroup(g.id, fixtures, customGroups).length;
    const row = document.createElement('div');
    row.className = 'group-row';
    const label = document.createElement('span');
    label.textContent = `${g.builtin ? '' : '★ '}${g.name}`;
    const right = document.createElement('span');
    right.style.display = 'flex';
    right.style.alignItems = 'center';
    right.style.gap = '4px';
    const countEl = document.createElement('span');
    countEl.className = 'hint';
    countEl.textContent = count;
    right.appendChild(countEl);

    if (!g.builtin && callbacks.onEdit) {
      const editBtn = document.createElement('button');
      editBtn.className = 'icon-btn';
      editBtn.textContent = '✎';
      editBtn.title = 'Rename / edit members';
      editBtn.addEventListener('click', () => callbacks.onEdit(g.id));
      right.appendChild(editBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'icon-btn';
      delBtn.textContent = '✕';
      delBtn.title = 'Delete group';
      delBtn.addEventListener('click', () => callbacks.onDelete(g.id));
      right.appendChild(delBtn);
    }

    row.append(label, right);
    container.appendChild(row);
  }
}

/**
 * Create or edit a custom group. Pass `existingGroup` to edit it in place —
 * `onSave` then receives an object carrying the same `id` so the caller can
 * replace rather than append.
 */
export function openGroupModal(fixtures, onSave, existingGroup = null) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `<h3>${existingGroup ? 'Edit Group' : 'New Group'}</h3>`;

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Group name';
  nameInput.style.width = '100%';
  nameInput.value = existingGroup?.name || '';
  modal.appendChild(nameInput);

  const list = document.createElement('div');
  list.style.marginTop = '10px';
  list.style.maxHeight = '240px';
  list.style.overflowY = 'auto';
  const checks = [];
  for (const f of fixtures) {
    const row = document.createElement('label');
    row.className = 'field checkbox-field';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!existingGroup?.fixtureIds.includes(f.id);
    checks.push({ id: f.id, cb });
    row.append(f.name, cb);
    list.appendChild(row);
  }
  modal.appendChild(list);

  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const cancel = document.createElement('button');
  cancel.className = 'btn btn-ghost';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => backdrop.remove());
  const save = document.createElement('button');
  save.className = 'btn btn-primary';
  save.textContent = existingGroup ? 'Save' : 'Create';
  save.addEventListener('click', () => {
    const ids = checks.filter((c) => c.cb.checked).map((c) => c.id);
    if (!nameInput.value.trim()) { backdrop.remove(); return; }
    if (existingGroup) {
      onSave({ ...existingGroup, name: nameInput.value.trim(), fixtureIds: ids });
    } else {
      onSave(createCustomGroup(nameInput.value.trim(), ids));
    }
    backdrop.remove();
  });
  actions.append(cancel, save);
  modal.appendChild(actions);

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
}

/**
 * Compact "assign this fixture to groups" popover, opened from a fixture row
 * (one click, no need to go find/open the group editor separately). Toggling
 * a checkbox applies immediately via `onToggle`.
 */
export function openAssignGroupsModal(fixture, customGroups, { onToggle, onCreateGroup }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `<h3>Assign "${escapeHtml(fixture.name)}" to groups</h3>`;

  const builtinNote = document.createElement('div');
  builtinNote.className = 'empty-hint';
  builtinNote.style.marginBottom = '8px';
  builtinNote.textContent = `Built-in groups (front/back/left/right/center/${fixture.type}/all) are automatic — this fixture already belongs to them based on its position and type.`;
  modal.appendChild(builtinNote);

  const list = document.createElement('div');
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = '6px';
  list.style.maxHeight = '220px';
  list.style.overflowY = 'auto';

  if (customGroups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-hint';
    empty.textContent = 'No custom groups yet — create one below.';
    list.appendChild(empty);
  }
  for (const group of customGroups) {
    const row = document.createElement('label');
    row.className = 'field checkbox-field';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = group.fixtureIds.includes(fixture.id);
    cb.addEventListener('change', () => onToggle(group.id, cb.checked));
    row.append(group.name, cb);
    list.appendChild(row);
  }
  modal.appendChild(list);

  const newGroupRow = document.createElement('div');
  newGroupRow.className = 'field-row';
  newGroupRow.style.marginTop = '10px';
  const newNameInput = document.createElement('input');
  newNameInput.type = 'text';
  newNameInput.placeholder = 'New group name…';
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-ghost small';
  addBtn.textContent = '+ Create';
  addBtn.addEventListener('click', () => {
    if (!newNameInput.value.trim()) return;
    onCreateGroup(newNameInput.value.trim());
    backdrop.remove();
  });
  newGroupRow.append(newNameInput, addBtn);
  modal.appendChild(newGroupRow);

  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const done = document.createElement('button');
  done.className = 'btn btn-primary';
  done.textContent = 'Done';
  done.addEventListener('click', () => backdrop.remove());
  actions.appendChild(done);
  modal.appendChild(actions);

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
