const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('drippyTrends', {
  get: () => ipcRenderer.invoke('drippy:history'),
  prefs: () => ipcRenderer.invoke('drippy:prefs'),
  setPlan: (plan) => ipcRenderer.invoke('drippy:set-plan', plan),
});
