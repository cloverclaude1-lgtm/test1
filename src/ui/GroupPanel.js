import { listAllGroups, createCustomGroup, resolveGroup } from '../lighting/Groups.js';

export function renderGroupList(container, fixtures, customGroups) {
  container.innerHTML = '';
  const groups = listAllGroups(customGroups);
  for (const g of groups) {
    const count = resolveGroup(g.id, fixtures, customGroups).length;
    const row = document.createElement('div');
    row.className = 'group-row';
    row.innerHTML = `<span>${g.builtin ? '' : '★ '}${g.name}</span><span class="hint">${count}</span>`;
    container.appendChild(row);
  }
}

export function openGroupModal(fixtures, onSave) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = '<h3>New Group</h3>';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Group name';
  nameInput.style.width = '100%';
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
  save.textContent = 'Create';
  save.addEventListener('click', () => {
    const ids = checks.filter((c) => c.cb.checked).map((c) => c.id);
    if (nameInput.value.trim()) onSave(createCustomGroup(nameInput.value.trim(), ids));
    backdrop.remove();
  });
  actions.append(cancel, save);
  modal.appendChild(actions);

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
}
