/**
 * ARIS Open — Electron smoke test
 * ===============================
 * Boots the real app (index.html + real src/preload.js) in a BrowserWindow
 * under the installed dev Electron, then verifies:
 *   - window loads without a did-fail-load / render-process-gone
 *   - window.aris bridge is present (preload ran)
 *   - key UI nodes render (toolbar, canvas container, model list)
 * Exits 0 on success, 1 on failure. Run: node scripts/smoke-electron.cjs
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const electron = require(path.join(ROOT, 'node_modules/electron'));
const preload = path.join(ROOT, 'src', 'preload.js');
const indexHtml = path.join(ROOT, 'index.html');

const appFile = path.join(__dirname, '_smoke-harness.cjs');
// Generate a tiny CJS harness app (electron needs main to be CJS or ESM
// resolvable — the project is ESM, so use a small CJS harness here).
const harnessJs = `
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const rawArg = process.argv.slice(1).find(a => a.startsWith('--smoke-meta=')) || '{"preload":"x","indexHtml":"x","expectedIds":[]}';
const args = JSON.parse(rawArg.slice('--smoke-meta='.length));
const { preload, indexHtml, expectedIds } = args;

let failures = [];
let consoleMsgs = [];

app.on('ready', () => {
  const win = new BrowserWindow({
    width: 1200, height: 800, show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  win.webContents.on('console', (_e, level, message) => {
    consoleMsgs.push({ level, message });
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    failures.push('did-fail-load: ' + code + ' ' + desc);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    failures.push('render-process-gone: ' + JSON.stringify(details));
  });

  win.loadFile(indexHtml).then(async () => {
    // give the renderer a moment to wire up (preload runs before DOMContentLoaded)
    await new Promise((r) => setTimeout(r, 700));
    try {
      const result = await win.webContents.executeJavaScript(\`
        (() => {
          const ids = \${JSON.stringify(expectedIds)};
          const report = {
            arisBridge: typeof window.aris === 'object' && window.aris !== null,
            nodes: {},
          };
          for (const id of ids) {
            report.nodes[id] = !!document.getElementById(id);
          }
          report.title = document.title;
          return report;
        })()
      \`);
      if (!result.arisBridge) failures.push('window.aris bridge missing (preload did not run)');
      for (const [id, ok] of Object.entries(result.nodes)) {
        if (!ok) failures.push('missing expected node #' + id);
      }
    } catch (err) {
      failures.push('executeJavaScript failed: ' + err.message);
    }

    const errors = consoleMsgs.filter((m) => /error/i.test(m.message));
    if (errors.length) failures.push('renderer console errors: ' + errors.map((e) => e.message).slice(0, 5).join(' | '));

    const out = { ok: failures.length === 0, failures, consoleErrorsCount: errors.length };
    process.stdout.write('SMOKE-RESULT ' + JSON.stringify(out) + '\\n');
    app.exit(out.ok ? 0 : 1);
  }).catch((err) => {
    process.stdout.write('SMOKE-RESULT ' + JSON.stringify({ ok: false, failures: ['loadFile: ' + err.message] }) + '\\n');
    app.exit(1);
  });
});
`;
fs.writeFileSync(appFile, harnessJs);

const meta = JSON.stringify({ preload, indexHtml, expectedIds: [
  'toolbar', 'brand', 'btn-new', 'canvas', 'canvas-wrap', 'model-select',
  'left-panel', 'right-panel', 'statusbar', 'zoom-label', 'workarea',
] });

const child = spawn(electron, [appFile, '--smoke-meta=' + meta], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
});

let out = '', err = '';
child.stdout.on('data', (d) => { out += d.toString(); });
child.stderr.on('data', (d) => { err += d.toString(); });

const timeout = setTimeout(() => { child.kill('SIGKILL'); }, 25000);
child.on('close', (code) => {
  clearTimeout(timeout);
  const resLine = out.split('\n').find((l) => l.startsWith('SMOKE-RESULT'));
  let res = null;
  try { res = JSON.parse(resLine.replace('SMOKE-RESULT ', '')); } catch { /* no result line */ }
  console.log('exit code:', code);
  console.log('result  :', res ? JSON.stringify(res, null, 2) : '(no SMOKE-RESULT line)');
  if (res && res.consoleErrorsCount > 0) {
    const errs = (out.match(/SMOKE-RESULT .*/)||[''])[0];
    console.log('console errors reported in result (see failures list)');
  }
  if (err.trim()) console.log('--- stderr (tail) ---\n' + err.trim().split('\n').slice(-12).join('\n'));
  process.exit(code === 0 && res && res.ok ? 0 : 1);
});
