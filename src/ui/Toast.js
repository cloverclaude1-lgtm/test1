// ---------------------------------------------------------------------------
// Toast.js — lightweight in-app notifications + confirm dialog.
//
// Several menubar actions (Generate Show, Advanced toggle, Save Project) are
// correct but give no visible feedback, which reads as "broken" to a user.
// Native `confirm()`/`alert()` are also unreliable inside some embedded
// preview/webview surfaces (they can be suppressed or styled inconsistently).
// This module gives every action a visible, consistent, in-app response.
// ---------------------------------------------------------------------------

let toastHost = null;
function getHost() {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.className = 'toast-host';
    document.body.appendChild(toastHost);
  }
  return toastHost;
}

/** Shows a transient banner. `type` is 'info' (default), 'success', or 'error'. */
export function showToast(message, { type = 'info', durationMs = 3200 } = {}) {
  const host = getHost();
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, durationMs);
}

/** In-app replacement for window.confirm(); resolves true/false. */
export function showConfirm(message, { confirmLabel = 'Confirm', cancelLabel = 'Cancel' } = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<p style="margin:0 0 4px;font-size:13px;line-height:1.5;">${escapeHtml(message)}</p>`;

    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const cancel = document.createElement('button');
    cancel.className = 'btn btn-ghost';
    cancel.textContent = cancelLabel;
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn btn-primary';
    confirmBtn.textContent = confirmLabel;

    const finish = (result) => { backdrop.remove(); resolve(result); };
    cancel.addEventListener('click', () => finish(false));
    confirmBtn.addEventListener('click', () => finish(true));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) finish(false); });

    actions.append(cancel, confirmBtn);
    modal.appendChild(actions);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    confirmBtn.focus();
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
