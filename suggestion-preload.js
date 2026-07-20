const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('drippySuggest', {
  onData: (cb) => ipcRenderer.on('suggest:data', (_e, d) => cb(d)),
  onTail: (cb) => ipcRenderer.on('suggest:tail', (_e, t) => cb(t)),
  act: () => ipcRenderer.send('suggest:act'),
  dismiss: () => ipcRenderer.send('suggest:dismiss'),
  hideNow: () => ipcRenderer.send('suggest:hide'),
  outcome: (id, kind) => ipcRenderer.send('suggest:outcome', { id, kind }),
  hover: (over) => ipcRenderer.send('suggest:hover', { over }),
  reportHeight: (h) => ipcRenderer.send('suggest:height', { h }),
});
