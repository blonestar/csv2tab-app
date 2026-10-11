import { app, Menu } from 'electron';
import type { MainCommand } from '../shared/api';
import type { Theme } from '../shared/settings';

export function installMenu(command: (c: MainCommand) => void, theme: Theme, setTheme: (t: Theme) => void): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Datoteka', submenu: [
      { id: 'import', label: 'Uvezi fajl…', accelerator: 'CommandOrControl+O', click: () => command('import') },
      { id: 'export', label: 'Izvezi u WT folder', accelerator: 'CommandOrControl+S', click: () => command('export') },
      { type: 'separator' },
      { id: 'settings', label: 'Podešavanja', click: () => command('settings') },
      { type: 'separator' },
      { label: 'Izađi', accelerator: 'CommandOrControl+Q', click: () => app.quit() },
    ] },
    { label: 'Uređivanje', submenu: [
      { label: 'Poništi', role: 'undo' }, { label: 'Ponovi', role: 'redo' }, { type: 'separator' },
      { label: 'Iseci', role: 'cut' }, { label: 'Kopiraj', role: 'copy' }, { label: 'Nalepi', role: 'paste' },
      { label: 'Izaberi sve', role: 'selectAll' }, { type: 'separator' },
      { id: 'search', label: 'Pretraga poslova', accelerator: 'CommandOrControl+F', click: () => command('search') },
    ] },
    { label: 'Prikaz', submenu: [
      { label: 'Tema', submenu: (['system', 'light', 'dark'] as const).map((t) => ({
        id: `theme-${t}`, label: { system: 'Sistemska', light: 'Svetla', dark: 'Tamna' }[t],
        type: 'radio' as const, checked: theme === t, click: () => setTheme(t),
      })) },
      { type: 'separator' }, { label: 'Uvećaj', role: 'zoomIn' }, { label: 'Umanji', role: 'zoomOut' },
      { label: 'Stvarna veličina', role: 'resetZoom' }, { label: 'Ceo ekran', role: 'togglefullscreen' },
    ] },
    { label: 'Pomoć', submenu: [
      { id: 'updates', label: 'Proveri ažuriranja…', click: () => command('updates') },
      { type: 'separator' },
      { id: 'about', label: 'O programu', click: () => command('about') },
    ] },
  ]));
}
