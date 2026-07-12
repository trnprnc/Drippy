const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('drippyTrends', {
  get: () => ipcRenderer.invoke('drippy:history'),
});
