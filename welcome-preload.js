const { contextBridge, ipcRenderer } = require('electron');
const factors = require('./impact-factors.json');

contextBridge.exposeInMainWorld('drippyInfo', {
  openAccessibility: () => ipcRenderer.send('drippy:open-accessibility'),
  factorsVersion: factors.version,
  syncInfo: () => ipcRenderer.invoke('sync:info'),
  syncSet: (enabled) => ipcRenderer.invoke('sync:set', enabled),
});
