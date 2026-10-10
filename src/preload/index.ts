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
};

contextBridge.exposeInMainWorld('api', api);
