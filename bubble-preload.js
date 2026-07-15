const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('drippyBubble', {
  onData: (cb) => ipcRenderer.on('bubble:data', (_e, data) => cb(data)),
  hover: (over) => ipcRenderer.send('drippy:bubble-hover', { over }),
  action: () => ipcRenderer.send('drippy:bubble-action'),
  reportHeight: (h) => ipcRenderer.send('drippy:bubble-height', { h }),
});
