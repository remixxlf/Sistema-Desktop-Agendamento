const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    onUpdateStatus: (callback) => ipcRenderer.on('update-status', (event, data) => callback(data)),
    onQRCode: (callback) => ipcRenderer.on('qr-code', (event, qrBase64) => callback(qrBase64)),
    openPanel: () => ipcRenderer.send('open-panel')
});
