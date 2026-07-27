// Sandboxed preload: only built-ins may be required here, so anything
// from the app (like the factors version) comes over IPC.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('drippyInfo', {
  factorsVersion: () => ipcRenderer.invoke('drippy:factors-version'),
  syncInfo: () => ipcRenderer.invoke('sync:info'),
  syncSet: (enabled) => ipcRenderer.invoke('sync:set', enabled),
});
