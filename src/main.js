import './style.css';
import { App } from './App.js';

window.addEventListener('DOMContentLoaded', () => {
  window.__lightstage = new App();
});

// Offline mode (brief roadmap item #11): registering this makes the app
// bootable with no network on later visits — see public/sw.js for how. Safe
// to call unconditionally; browsers without support just skip the `if`.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('LightStage: service worker registration failed (offline mode unavailable):', err);
    });
  });
}
