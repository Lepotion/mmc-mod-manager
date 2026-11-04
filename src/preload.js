const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, p) => cb(p)),
  // Results of work started outside the window, e.g. an nxm:// link.
  onExternal: (cb) => ipcRenderer.on('external', (_e, p) => cb(p)),
  // Background download jobs (list of { id, name, kind, status, received, total, speed, ... }).
  onJobs: (cb) => ipcRenderer.on('jobs', (_e, jobs) => cb(jobs)),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onGameRunning: (cb) => ipcRenderer.on('game-running', (_e, running) => cb(running)),
  // FOMOD installer questions; answer with fomodAnswer(id, choices | null).
  onFomod: (cb) => ipcRenderer.on('fomod', (_e, p) => cb(p)),
  fomodAnswer: (id, choices) => ipcRenderer.send('fomod:answer', id, choices),
  pathForFile: (file) => webUtils.getPathForFile(file),
});
