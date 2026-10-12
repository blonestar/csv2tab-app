// Most: izlaže window.api sa imenovanim operacijama. Mora da bude jedan CommonJS fajl (sandbox: true).
import { contextBridge, ipcRenderer } from 'electron';
import type { Api } from '../shared/api';
import { MAIN_COMMANDS, type MainCommand } from '../shared/api';
import type { UpdateState } from '../shared/update';

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
    next: (...args) => ipcRenderer.invoke('files.next', ...args),
    chooseFolder: (key) => ipcRenderer.invoke('files.chooseFolder', key),
  },
  export: {
    check: (items) => ipcRenderer.invoke('export.check', items),
    write: (items, overwrite, jobId) => ipcRenderer.invoke('export.write', items, overwrite, jobId),
    save: (items, jobId) => ipcRenderer.invoke('export.save', items, jobId),
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
    onCommand(handler) {
      const listener = (_event: unknown, command: unknown) => {
        if ((MAIN_COMMANDS as readonly unknown[]).includes(command)) handler(command as MainCommand);
      };
      ipcRenderer.on('app.command', listener);
      return () => void ipcRenderer.removeListener('app.command', listener);
    },
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
  update: {
    state: () => ipcRenderer.invoke('update.state'),
    check: () => ipcRenderer.invoke('update.check'),
    download: () => ipcRenderer.invoke('update.download'),
    install: () => ipcRenderer.invoke('update.install'),
    onState(handler) {
      const listener = (_event: unknown, state: unknown) => {
        // samo objekat stiže iz glavnog procesa; sve ostalo se ignoriše
        if (typeof state === 'object' && state !== null) handler(state as UpdateState);
      };
      ipcRenderer.on('update.state', listener);
      return () => void ipcRenderer.removeListener('update.state', listener);
    },
  },
};

contextBridge.exposeInMainWorld('api', api);
