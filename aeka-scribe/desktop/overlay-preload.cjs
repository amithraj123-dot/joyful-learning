const { ipcRenderer } = require('electron');
window.addEventListener('DOMContentLoaded', () => {
  ipcRenderer.on('aeka-scribe-event', (_e, data) => {
    if (data.type === 'overlay-state') document.getElementById('state').textContent = data.state;
  });
});
