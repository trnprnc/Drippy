const { contextBridge, ipcRenderer } = require('electron');
const factors = require('./impact-factors.json');

contextBridge.exposeInMainWorld('drippyInfo', {
  openAccessibility: () => ipcRenderer.send('drippy:open-accessibility'),
  factorsVersion: factors.version,
});
