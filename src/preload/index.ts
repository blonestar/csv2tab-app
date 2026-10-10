// Most: izlaže window.api sa imenovanim operacijama. Mora da bude jedan CommonJS fajl (sandbox: true).
import { contextBridge, ipcRenderer } from 'electron';
import type { Api } from '../shared/api';

const api: Api = {
  app: {
    info: () => ipcRenderer.invoke('app.info'),
  },
};

contextBridge.exposeInMainWorld('api', api);
