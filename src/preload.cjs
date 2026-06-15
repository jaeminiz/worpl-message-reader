const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("worplReader", {
  openChrome: (startUrl) => ipcRenderer.invoke("reader:openChrome", startUrl),
  preview: (options) => ipcRenderer.invoke("reader:preview", options),
  run: (options) => ipcRenderer.invoke("reader:run", options),
  openPreviewMessage: (index, options) => ipcRenderer.invoke("reader:openPreviewMessage", index, options),
  openPath: (filePath) => ipcRenderer.invoke("reader:openPath", filePath),
  getVersion: () => ipcRenderer.invoke("reader:getVersion")
});
