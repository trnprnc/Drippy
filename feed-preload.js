const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('drippyFeed', {
  get: () => ipcRenderer.invoke('suggest:feed'),
  outcome: (id, kind) => ipcRenderer.send('suggest:outcome', { id, kind }),
});
