const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openAsset: () => ipcRenderer.invoke('asset:open'),
  captureScreens: () => ipcRenderer.invoke('capture:screens')
});
