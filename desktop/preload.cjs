const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("htmlMenderDesktop", {
  saveExport: ({ url, suggestedName }) => ipcRenderer.invoke("save-task-export", { url, suggestedName })
});
