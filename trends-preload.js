const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('drippyTrends', {
  get: () => ipcRenderer.invoke('drippy:history'),
  prefs: () => ipcRenderer.invoke('drippy:prefs'),
  setPref: (key, value) => ipcRenderer.invoke('drippy:set-pref', key, value),
  setPlan: (plan) => ipcRenderer.invoke('drippy:set-pref', 'plan', plan),
});
