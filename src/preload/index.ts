// Most: izlaže window.api sa imenovanim operacijama. Mora da bude jedan CommonJS fajl (sandbox: true).
import { contextBridge, ipcRenderer } from 'electron';
import type { Api } from '../shared/api';

const api: Api = {
  app: {
    info: () => ipcRenderer.invoke('app.info'),
  },
  settings: {
    get: (key) => ipcRenderer.invoke('settings.get', key),
    all: () => ipcRenderer.invoke('settings.all'),
    set: (key, value) => ipcRenderer.invoke('settings.set', key, value),
  },
  catalog: {
    get: () => ipcRenderer.invoke('catalog.get'),
  },
  files: {
    open: (purpose) => ipcRenderer.invoke('files.open', purpose),
    chooseFolder: (key) => ipcRenderer.invoke('files.chooseFolder', key),
  },
  export: {
    check: (items) => ipcRenderer.invoke('export.check', items),
    write: (items, overwrite) => ipcRenderer.invoke('export.write', items, overwrite),
  },
  compare: {
    open: (payload) => ipcRenderer.invoke('compare.open', payload),
    get: (id) => ipcRenderer.invoke('compare.get', id),
  },
};

contextBridge.exposeInMainWorld('api', api);
