/**
 * ARIS Open — Electron main process
 * =================================
 * Window management, application menu, native file dialogs (open/save AML XML
 * and .ajos JSON), and the IPC bridge consumed by src/renderer.js via
 * window.aris (see src/preload.js).
 */
import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron';
import path   from 'node:path';
import fs     from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
//  App / window
// ---------------------------------------------------------------------------

const APP_NAME = 'ARIS Open';
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    title: APP_NAME,
    backgroundColor: '#0e1116',
    show: false,
    autoHideMenuBar: process.platform === 'darwin',
    webPreferences: {
      preload:           path.join(__dirname, 'preload.js'),
      contextIsolation:  true,
      nodeIntegration:   false,
      sandbox:           false,     // preload uses ESM + electron imports
      spellcheck:        false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'))
    .catch((err) => console.error('[main] loadFile failed:', err));

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Open external links in the default browser, not a new Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ---------------------------------------------------------------------------
//  IPC — file I/O
// ---------------------------------------------------------------------------

const IPC = Object.freeze({
  OPEN_FILE:     'aris:open-file',
  SAVE_FILE:     'aris:save-file',
  SAVE_DIALOG:   'aris:save-dialog',
  OPEN_DIALOG:   'aris:open-dialog',
  APP_INFO:      'aris:app-info',
});

function registerIpc() {
  // Open an existing file (dialog + read)
  ipcMain.handle(IPC.OPEN_FILE, async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Open AML / ARIS Open file',
      buttonLabel: 'Open',
      filters: [
        { name: 'ARIS AML / XML',  extensions: ['aml', 'xml'] },
        { name: 'ARIS Open JSON', extensions: ['ajos', 'json'] },
        { name: 'All files',      extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (canceled || !filePaths.length) return null;
    const p = filePaths[0];
    const text = await fs.readFile(p, 'utf8');
    return { path: p, name: path.basename(p), text };
  });

  // Save with a fresh Save As dialog
  ipcMain.handle(IPC.SAVE_FILE, async (evt, payload) => {
    const { text, defaultName = 'diagram.aml' } = payload || {};
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save AML / ARIS Open file',
      buttonLabel: 'Save',
      defaultPath: defaultName,
      filters: [
        { name: 'ARIS AML / XML',  extensions: ['aml', 'xml'] },
        { name: 'ARIS Open JSON', extensions: ['ajos', 'json'] },
        { name: 'All files',      extensions: ['*'] },
      ],
    });
    if (canceled || !filePath) return null;
    await fs.writeFile(filePath, text, 'utf8');
    return { path: filePath };
  });

  // Plain read (path already known, e.g. reopening a previous file)
  ipcMain.handle(IPC.OPEN_DIALOG, async (_evt, p) => {
    if (!p) return null;
    const text = await fs.readFile(p, 'utf8');
    return { path: p, name: path.basename(p), text };
  });

  ipcMain.handle(IPC.APP_INFO, async () => ({
    name:            app.getName() || APP_NAME,
    version:         app.getVersion(),
    electron:        process.versions.electron,
    chrome:          process.versions.chrome,
    node:            process.versions.node,
    platform:        process.platform,
    arch:            process.arch,
  }));
}

// ---------------------------------------------------------------------------
//  Menu
// ---------------------------------------------------------------------------

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const send = (channel, payload) =>
    mainWindow?.webContents.send(channel, payload);

  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open…',
          accelerator: isMac ? 'CmdOrCtrl+O' : 'Ctrl+O',
          click: () => send('menu:open'),
        },
        {
          label: 'Save As…',
          accelerator: isMac ? 'CmdOrCtrl+Shift+S' : 'Ctrl+Shift+S',
          click: () => send('menu:save'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' }
             : { label: 'Exit', accelerator: 'Ctrl+Q', role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      role: 'viewMenu',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About ARIS Open',
          click: () => {
            send('menu:about', {
              name: APP_NAME,
              version: app.getVersion(),
            });
          },
        },
        {
          label: 'Documentation / Source',
          click: () => shell.openExternal('https://github.com/aris-open/aris-open'),
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

// ---------------------------------------------------------------------------
//  Lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  registerIpc();
  Menu.setApplicationMenu(buildMenu());
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
