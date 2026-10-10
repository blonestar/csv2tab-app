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
    write: (items, overwrite, jobId) => ipcRenderer.invoke('export.write', items, overwrite, jobId),
  },
  jobs: {
    list: (query) => ipcRenderer.invoke('jobs.list', query),
    findBySource: (sha256) => ipcRenderer.invoke('jobs.findBySource', sha256),
    get: (id) => ipcRenderer.invoke('jobs.get', id),
    create: (file, save) => ipcRenderer.invoke('jobs.create', file, save),
    save: (id, save) => ipcRenderer.invoke('jobs.save', id, save),
    update: (id, meta) => ipcRenderer.invoke('jobs.update', id, meta),
    delete: (id) => ipcRenderer.invoke('jobs.delete', id),
    exports: (id) => ipcRenderer.invoke('jobs.exports', id),
  },
  memory: {
    lookup: (query) => ipcRenderer.invoke('memory.lookup', query),
    remember: (update) => ipcRenderer.invoke('memory.remember', update),
    list: () => ipcRenderer.invoke('memory.list'),
    forget: (kind, key) => ipcRenderer.invoke('memory.forget', kind, key),
  },
  backup: {
    create: () => ipcRenderer.invoke('backup.create'),
    inspect: () => ipcRenderer.invoke('backup.inspect'),
    restore: (token) => ipcRenderer.invoke('backup.restore', token),
    cancel: (token) => ipcRenderer.invoke('backup.cancel', token),
    finish: () => ipcRenderer.invoke('backup.finish'),
  },
  lifecycle: {
    onFlushRequest(handler) {
      const listener = () => {
        void handler().then(
          (ok) => ipcRenderer.invoke('app.flushed', ok),
          () => ipcRenderer.invoke('app.flushed', false),
        );
      };
      ipcRenderer.on('app.flush', listener);
      return () => void ipcRenderer.removeListener('app.flush', listener);
    },
  },
  compare: {
    open: (payload) => ipcRenderer.invoke('compare.open', payload),
    get: (id) => ipcRenderer.invoke('compare.get', id),
  },
};

contextBridge.exposeInMainWorld('api', api);
