const { ipcRenderer } = require('electron');
window.addEventListener('DOMContentLoaded', () => {
  ipcRenderer.on('flow-event', (_e, data) => {
    if (data.type === 'overlay-state') document.getElementById('state').textContent = data.state;
  });
});
