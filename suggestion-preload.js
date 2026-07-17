const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('drippySuggest', {
  onData: (cb) => ipcRenderer.on('suggest:data', (_e, d) => cb(d)),
  act: () => ipcRenderer.send('suggest:act'),
  dismiss: () => ipcRenderer.send('suggest:dismiss'),
  hover: (over) => ipcRenderer.send('suggest:hover', { over }),
  reportHeight: (h) => ipcRenderer.send('suggest:height', { h }),
});
