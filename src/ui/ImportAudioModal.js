/**
 * "Import Audio" entry point — a small modal with a drag-and-drop area, reusing
 * the onboarding screen's `.dropzone` look instead of jumping straight to the
 * native file picker. `onFile(file)` is called once with the chosen/dropped file
 * and the modal closes itself; `browseInput` is the app's existing hidden file
 * input (`App.js`'s `_audioImportInput`) so "Browse Files" reuses the same
 * native picker rather than creating a second one.
 */
export function openImportAudioModal(browseInput, onFile) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = '<h3>Import Audio</h3>';

  const dropzone = document.createElement('div');
  dropzone.className = 'dropzone';
  dropzone.innerHTML = `
    <div class="dropzone-icon">🎵</div>
    <div class="dropzone-title">Drop a song here</div>
    <div class="dropzone-sub">or</div>
  `;
  const browseBtn = document.createElement('button');
  browseBtn.className = 'btn btn-primary';
  browseBtn.textContent = 'Browse Files';
  dropzone.appendChild(browseBtn);
  modal.appendChild(dropzone);

  const finish = (file) => {
    backdrop.remove();
    if (file) onFile(file);
  };

  browseBtn.addEventListener('click', () => {
    const onChangeOnce = () => {
      browseInput.removeEventListener('change', onChangeOnce);
      finish(browseInput.files[0] || null);
    };
    browseInput.addEventListener('change', onChangeOnce);
    browseInput.click();
  });

  ['dragover', 'dragenter'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); }));
  dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file) finish(file);
  });

  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const cancel = document.createElement('button');
  cancel.className = 'btn btn-ghost';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => backdrop.remove());
  actions.appendChild(cancel);
  modal.appendChild(actions);

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
}
