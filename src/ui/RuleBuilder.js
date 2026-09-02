import { CONDITION_TYPES, ACTION_TYPES, createRule, describeRule } from '../lighting/RuleEngine.js';
import { listAllGroups } from '../lighting/Groups.js';

export function renderRuleList(container, rules, callbacks) {
  container.innerHTML = '';
  if (rules.length === 0) {
    container.innerHTML = '<div class="empty-hint">No rules yet. Try: WHEN Bass &gt; 80% THEN Flash Strobes.</div>';
    return;
  }
  for (const rule of rules) {
    const { condText, actionText } = describeRule(rule);
    const row = document.createElement('div');
    row.className = 'rule-row';
    row.innerHTML = `
      <div class="rule-summary"><b>WHEN</b> ${condText}<br/><b>THEN</b> ${actionText}</div>
    `;
    const actions = document.createElement('div');
    actions.className = 'fixture-row-actions';
    const toggle = document.createElement('button');
    toggle.className = 'icon-btn';
    toggle.textContent = rule.enabled ? '⏸' : '▶';
    toggle.title = rule.enabled ? 'Disable' : 'Enable';
    toggle.addEventListener('click', () => callbacks.onToggle(rule.id));
    const edit = document.createElement('button');
    edit.className = 'icon-btn';
    edit.textContent = '✎';
    edit.addEventListener('click', () => callbacks.onEdit(rule));
    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.textContent = '✕';
    del.addEventListener('click', () => callbacks.onDelete(rule.id));
    actions.append(toggle, edit, del);
    row.appendChild(actions);
    container.appendChild(row);
  }
}

/** Opens a modal form for creating/editing one rule. Calls onSave(rule) or nothing on cancel. */
export function openRuleModal(existingRule, customGroups, onSave) {
  const rule = existingRule ? JSON.parse(JSON.stringify(existingRule)) : createRule({});
  if (!rule.conditions.length) rule.conditions.push({ type: 'bass', op: '>', value: 0.8, negate: false });
  if (!rule.actions.length) rule.actions.push({ type: 'flash', group: 'all', amount: 0.9, durationMs: 150 });

  const groups = listAllGroups(customGroups);

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  backdrop.appendChild(modal);

  modal.innerHTML = `<h3>${existingRule ? 'Edit Rule' : 'New Rule'}</h3>`;

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = rule.name;
  nameInput.style.width = '100%';
  nameInput.style.marginBottom = '10px';
  modal.appendChild(field('Rule name', nameInput));

  const logicSelect = document.createElement('select');
  logicSelect.innerHTML = `<option value="AND">ALL of (AND)</option><option value="OR">ANY of (OR)</option>`;
  logicSelect.value = rule.logic;
  modal.appendChild(field('WHEN', logicSelect));

  const condContainer = document.createElement('div');
  modal.appendChild(condContainer);
  const addCondBtn = document.createElement('button');
  addCondBtn.className = 'btn btn-ghost tiny';
  addCondBtn.textContent = '+ Condition';
  addCondBtn.addEventListener('click', () => {
    rule.conditions.push({ type: 'beat', op: '>', value: 0.8, negate: false });
    renderConditions();
  });
  modal.appendChild(addCondBtn);

  const actionContainer = document.createElement('div');
  actionContainer.style.marginTop = '12px';
  modal.appendChild(document.createElement('h3')).textContent = 'THEN';
  modal.appendChild(actionContainer);
  const addActionBtn = document.createElement('button');
  addActionBtn.className = 'btn btn-ghost tiny';
  addActionBtn.textContent = '+ Action';
  addActionBtn.addEventListener('click', () => {
    rule.actions.push({ type: 'setBrightness', group: 'all', value: 1 });
    renderActions();
  });
  modal.appendChild(addActionBtn);

  const modalActions = document.createElement('div');
  modalActions.className = 'modal-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-ghost';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => backdrop.remove());
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Save Rule';
  saveBtn.addEventListener('click', () => {
    rule.name = nameInput.value || 'Rule';
    rule.logic = logicSelect.value;
    onSave(rule);
    backdrop.remove();
  });
  modalActions.append(cancelBtn, saveBtn);
  modal.appendChild(modalActions);

  function renderConditions() {
    condContainer.innerHTML = '';
    rule.conditions.forEach((cond, i) => {
      const row = document.createElement('div');
      row.className = 'field-row';
      row.style.marginBottom = '6px';

      const typeSel = document.createElement('select');
      for (const t of CONDITION_TYPES) typeSel.innerHTML += `<option value="${t.id}" ${t.id === cond.type ? 'selected' : ''}>${t.label}</option>`;
      typeSel.addEventListener('change', () => { cond.type = typeSel.value; renderConditions(); });

      const meta = CONDITION_TYPES.find((t) => t.id === cond.type);
      row.appendChild(field('', typeSel));

      if (meta?.hasValue) {
        const opSel = document.createElement('select');
        opSel.innerHTML = `<option value=">" ${cond.op !== '<' ? 'selected' : ''}>&gt;</option><option value="<" ${cond.op === '<' ? 'selected' : ''}>&lt;</option>`;
        opSel.addEventListener('change', () => (cond.op = opSel.value));
        row.appendChild(field('', opSel));

        const valInput = document.createElement('input');
        valInput.type = 'range';
        valInput.min = 0; valInput.max = 1; valInput.step = 0.01;
        valInput.value = cond.value ?? 0.8;
        valInput.addEventListener('input', () => (cond.value = parseFloat(valInput.value)));
        row.appendChild(field(`${Math.round((cond.value ?? 0.8) * 100)}%`, valInput));
      }

      const negLabel = document.createElement('label');
      negLabel.className = 'field checkbox-field';
      const negCb = document.createElement('input');
      negCb.type = 'checkbox';
      negCb.checked = !!cond.negate;
      negCb.addEventListener('change', () => (cond.negate = negCb.checked));
      negLabel.append('NOT ', negCb);
      row.appendChild(negLabel);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'icon-btn';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => { rule.conditions.splice(i, 1); renderConditions(); });
      row.appendChild(removeBtn);

      condContainer.appendChild(row);
    });
  }

  function renderActions() {
    actionContainer.innerHTML = '';
    rule.actions.forEach((action, i) => {
      const row = document.createElement('div');
      row.className = 'field-row';
      row.style.marginBottom = '6px';
      row.style.flexWrap = 'wrap';

      const typeSel = document.createElement('select');
      for (const t of ACTION_TYPES) typeSel.innerHTML += `<option value="${t.id}" ${t.id === action.type ? 'selected' : ''}>${t.label}</option>`;
      typeSel.addEventListener('change', () => {
        rule.actions[i] = { type: typeSel.value, group: 'all' };
        renderActions();
      });
      row.appendChild(field('', typeSel));

      if (ACTION_TYPES.find((t) => t.id === action.type)?.params.includes('group')) {
        const groupSel = document.createElement('select');
        for (const g of groups) groupSel.innerHTML += `<option value="${g.id}" ${g.id === action.group ? 'selected' : ''}>${g.name}</option>`;
        groupSel.addEventListener('change', () => (action.group = groupSel.value));
        row.appendChild(field('Target', groupSel));
      }

      appendActionParamInputs(row, action);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'icon-btn';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => { rule.actions.splice(i, 1); renderActions(); });
      row.appendChild(removeBtn);

      actionContainer.appendChild(row);
    });
  }

  function appendActionParamInputs(row, action) {
    const num = (label, key, def, min = 0, max = 1, step = 0.01) => {
      const input = document.createElement('input');
      input.type = 'range'; input.min = min; input.max = max; input.step = step;
      input.value = action[key] ?? def;
      action[key] = action[key] ?? def;
      input.addEventListener('input', () => (action[key] = parseFloat(input.value)));
      row.appendChild(field(label, input));
    };
    switch (action.type) {
      case 'setBrightness': num('Brightness', 'value', 1); break;
      case 'flash': num('Amount', 'amount', 0.9); num('Duration (ms)', 'durationMs', 150, 30, 1000, 10); break;
      case 'strobe': num('Rate', 'rate', 1); break;
      case 'pulse': num('Amount', 'amount', 0.4); num('Rate (Hz)', 'rateHz', 2, 0.2, 8, 0.1); break;
      case 'fade': num('Target', 'value', 1); num('Duration (s)', 'durationSec', 1, 0.1, 8, 0.1); break;
      case 'move': num('Pan', 'pan', 0, -1, 1); num('Tilt', 'tilt', 0, -1, 1); break;
      case 'changeColor': {
        const input = document.createElement('input');
        input.type = 'color';
        action.color = action.color || { r: 1, g: 1, b: 1 };
        const hex = (c) => `#${[c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
        input.value = hex(action.color);
        input.addEventListener('input', () => {
          const n = parseInt(input.value.slice(1), 16);
          action.color = { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
        });
        row.appendChild(field('Color', input));
        break;
      }
      default: break;
    }
  }

  function field(label, el) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    if (label) { const l = document.createElement('label'); l.textContent = label; wrap.appendChild(l); }
    wrap.appendChild(el);
    return wrap;
  }

  renderConditions();
  renderActions();
  document.body.appendChild(backdrop);
}
