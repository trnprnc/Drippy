const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('drippy', {
  onUpdate: (cb) => ipcRenderer.on('drippy:update', (_e, state) => cb(state)),
  dragStart: () => ipcRenderer.send('drippy:drag-start'),
  dragEnd: () => ipcRenderer.send('drippy:drag-end'),
  click: () => ipcRenderer.send('drippy:click'),
  hover: (over) => ipcRenderer.send('drippy:hover', { over }),
  onMorph: (cb) => ipcRenderer.on('drippy:morph', (_e, shape) => cb(shape)),
});
