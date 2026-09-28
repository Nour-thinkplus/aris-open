/**
 * ARIS Open — preload bridge (contextIsolation on)
 * =================================================
 * Exposes a minimal, Promise-based API on `window.aris`.
 * The renderer never touches Node or Electron internals directly.
 */
import { contextBridge, ipcRenderer } from 'electron';

const api = {
  // ---- files -----------------------------------------------------------
  openFile: () => ipcRenderer.invoke('aris:open-file'),
  saveFile: (text, defaultName) => ipcRenderer.invoke('aris:save-file', {
    text,
    defaultName: defaultName || 'diagram.aml',
  }),

  // ---- app -------------------------------------------------------------
  appInfo: () => ipcRenderer.invoke('aris:app-info'),

  // ---- menu events (main → renderer) -----------------------------------
  on(channel, listener) {
    // channels allowed to flow main→renderer
    const allowed = new Set(['menu:open', 'menu:save', 'menu:about']);
    if (!allowed.has(channel)) return;
    const wrapped = (_evt, payload) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
};

try {
  contextBridge.exposeInMainWorld('aris', api);
} catch (err) {
  // Dev over plain HTTP (npm run web) — no contextBridge available.
  /* eslint-disable no-undef */
  window.aris = api;
  /* eslint-enable no-undef */
}
