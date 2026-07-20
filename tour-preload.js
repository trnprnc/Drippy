const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('drippyTour', {
  onData: (cb) => ipcRenderer.on('tour:data', (_e, d) => cb(d)),
  onTail: (cb) => ipcRenderer.on('tour:tail', (_e, t) => cb(t)),
  next: () => ipcRenderer.send('tour:next'),
  skip: () => ipcRenderer.send('tour:skip'),
  reportHeight: (h) => ipcRenderer.send('tour:height', { h }),
});
