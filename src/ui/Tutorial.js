// ---------------------------------------------------------------------------
// Tutorial.js — a short, skippable, paginated walkthrough covering the parts
// of the app that aren't self-explanatory on first use: adding/positioning/
// grouping fixtures, generating a show, and reading the timeline.
// ---------------------------------------------------------------------------

const STEPS = [
  {
    title: 'Import a song',
    body: 'Drop an audio file on the start screen (or use "Import Audio" in the menu bar once you\'re in the editor). LightStage analyzes it automatically — BPM, beats, frequency bands, and song sections — before you do anything else.',
  },
  {
    title: 'Add & position fixtures',
    body: 'Click a fixture type in the left FIXTURES palette to add it to the rig. Select it in the RIG list to edit it on the right. Use the Quick Position buttons (Front / Back / Left / Right / Center) to snap it into place, or drag it directly on the 3D stage.',
  },
  {
    title: 'Group your fixtures',
    body: 'Click the 🏷 icon next to any fixture to assign it to a custom group (e.g. "Front Wash"). Built-in groups — Front/Back/Left/Right/Center and each fixture type — are automatic based on position and type. Groups let rules and scenes target many fixtures at once.',
  },
  {
    title: 'Generate & customize the show',
    body: 'Pick a style and click "Generate Show." Switch styles anytime to instantly re-light the same song differently. Select a fixture and check any "Manual" box in Properties to override brightness, color, movement, or strobe by hand — the automatic show works around it.',
  },
  {
    title: 'Read the timeline',
    body: 'The purple line is loudness, the colored blocks are the generated song sections (see the legend above it), and the tick marks are detected beats. Click anywhere on the timeline to jump the song — and the lights — to that moment.',
  },
  {
    title: 'Build your own rules (Advanced)',
    body: 'Click "Advanced" to reveal Groups and Rules. A rule is just WHEN a condition is true (e.g. "Bass > 80%") THEN an action happens (e.g. "Flash Strobes") — no code required.',
  },
];

export function openTutorial() {
  let index = 0;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal tutorial-modal';
  backdrop.appendChild(modal);

  function render() {
    const step = STEPS[index];
    modal.innerHTML = `
      <h3>${step.title}</h3>
      <p style="font-size:13px;line-height:1.6;color:var(--text-1);min-height:96px;">${step.body}</p>
      <div class="tutorial-dots">
        ${STEPS.map((_, i) => `<span class="tutorial-dot${i === index ? ' active' : ''}"></span>`).join('')}
      </div>
    `;

    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    actions.style.justifyContent = 'space-between';

    const skipBtn = document.createElement('button');
    skipBtn.className = 'btn btn-ghost';
    skipBtn.textContent = 'Close';
    skipBtn.addEventListener('click', () => backdrop.remove());

    const navGroup = document.createElement('div');
    navGroup.style.display = 'flex';
    navGroup.style.gap = '8px';

    if (index > 0) {
      const prevBtn = document.createElement('button');
      prevBtn.className = 'btn btn-ghost';
      prevBtn.textContent = 'Back';
      prevBtn.addEventListener('click', () => { index--; render(); });
      navGroup.appendChild(prevBtn);
    }

    const nextBtn = document.createElement('button');
    nextBtn.className = 'btn btn-primary';
    nextBtn.textContent = index === STEPS.length - 1 ? 'Done' : 'Next';
    nextBtn.addEventListener('click', () => {
      if (index === STEPS.length - 1) backdrop.remove();
      else { index++; render(); }
    });
    navGroup.appendChild(nextBtn);

    actions.append(skipBtn, navGroup);
    modal.appendChild(actions);
  }

  render();
  document.body.appendChild(backdrop);
}
