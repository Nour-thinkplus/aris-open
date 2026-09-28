<div align="center">

# ◆ ARIS Open

**Open-source process modeling & governance studio** — a clean-room
re-implementation of the core of SAP ARIS (10.2026.4.0) as a portable
cross-platform desktop app for **Windows** and **macOS** (plus Linux).

No license keys, no server, no telemetry. 100% local. MIT-licensed.

</div>

---

## What it is

ARIS Open is a desktop studio for designing, modeling, and validating
business process landscapes. It speaks the **native ARIS file format
(AML/XML)** and reproduces the **ARIS semantic-check rules** (EPC
structure, event/function cardinality, org-chart hierarchy, business-rule
checks), so models move between ARIS and ARIS Open with no conversion.

It is written in **plain modern JavaScript (ESM)** with **zero runtime
dependencies** for the modeling engine — only the Electron shell is a dev
dependency — so the core is trivially readable, testable, and embeddable.

## Core capabilities

| Capability | Notes |
|---|---|
| Object modeling | Function, Event, Process, Org unit, App system, Business rule |
| Connection types | `CT_CONTROLS`, `CT_IS_PRCSNT_SUPER/SUBORD`, `CT_IS_ORGN_UNIT`, `CT_IS_PERFORMED_BY`, `CT_IS_SUPPORTED_BY`, `CT_IS_ACCESSIBLE`, … |
| Semantic checks | Ported from the ARIS structure/EPC/org/business-rule profiles (severity 5 error / 4 warning / 3 info) |
| Import / export | **ARIS AML/XML** (DTD-compatible), **ARIS Open JSON** (lossless), **standalone SVG** |
| Editor | SVG canvas · select · drag · connect · delete · zoom · pan · fit · auto-layout · rename · properties |
| Undo / Redo | Full editor history via lossless JSON snapshots |
| Models | Multiple models per database, type-switch (EPC / ORG / BPMN / PROC) |
| Packaging | One installer for Windows (NSIS) & macOS (dmg, universal x64+arm64) |

## Requirements

- **Node.js ≥ 18** (Node 20/22 recommended)
- Any modern OS with Node for development
- A display of ≥ 1000 × 640 px to run it

## Install & run (development)

```bash
git clone <this-repo> aris-open
cd aris-open
npm install          # installs electron + electron-builder (dev only)
npm run icons        # regenerating the app icons (optional, assets already present)
npm start            # launches the Electron app
```

### Run the test suite

The core engine is fully unit-tested with Node's built-in `node:test` runner
(no mocha/jest dependency):

```bash
npm test
```

Expected (as of v0.1.0):

```
ℹ tests 16
ℹ pass 16
ℹ fail 0
```

Covered: model/JSON round-trip, AML XML import/export, SVG export, semantic
checks, and the internal XML engine.

### Bootstrap + smoke test

In addition to unit tests, `npm run smoke` boots the **real** app
(`index.html` + the production `src/preload.js`) inside a real Electron
`BrowserWindow` and asserts that:

- the window loads (no `did-fail-load`, no `render-process-gone`),
- the `window.aris` bridge is present (i.e. the preload bridge ran), and
- the key UI nodes (toolbar, canvas, panels, statusbar) render.

This runs as a **headless UI integration test**, not just a pure-Node unit
test. It's included in the one-shot health gate:

```bash
npm run check    # = npm test && npm run smoke
```

## Package for release (Windows & macOS)

Build native installers with `electron-builder` (already configured in
`package.json` → `build`):

```bash
# macOS — produces dist/*.dmg + dist/*.zip (universal: x64 + Apple Silicon)
npm run dist:mac

# Windows — produces dist/ARIS Open Setup <version>.exe (NSIS installer)
npm run dist:win

# Linux (bonus) — AppImage + .deb
npm run dist:linux

# current platform only
npm run dist
```

The macOS builds are **universal** (both `x64` and `arm64`), so a single
`.dmg` runs on Intel **and** Apple Silicon. The Windows build produces a
standard NSIS installer that lets the user choose the install directory and
creates a desktop shortcut.

> **Cross-platform note.** `electron-builder` signs macOS apps and builds
> Windows binaries. Building the Windows `.exe` from macOS (and the macOS
> `.dmg` from Windows) works through the built-in toolchain without Wine.
> For a **signed, notarized macOS release** you need a paid Apple Developer
> ID — until then, ship the un-notarized build with `--config.mac.identity=null`
> or instruct users to right-click → *Open* on first launch.

## Continuous integration (GitHub Actions)

`.github/workflows/ci.yml` runs on every push / PR to `main`
(`workflow_dispatch` for manual runs):

| Job         | Runner              | What it does                                                        |
|-------------|---------------------|---------------------------------------------------------------------|
| `test`      | `macos-latest`      | `npm ci` → Electron runtime install → `npm test` → `npm run smoke` → `npm audit --audit-level=high` |
| `build-macos`   | `macos-latest`   | `npm run dist:mac` → uploads `dist/*.dmg` + `dist/*.zip` (x64 + arm64) |
| `build-windows` | `windows-latest` | `npm run dist:win` → uploads `ARIS Open Setup 0.1.0.exe` + `win-unpacked/` |

Both build jobs depend on `test` (fail-fast). `CSC_IDENTITY_AUTO_DISCOVERY=false`
avoids code-signing lookups on the runners; artifacts are attached to every
run, so you can download installers without publishing a release.

On a clean `main` the expected green check is:

```
✔ tests 16 / pass 16 / fail 0
✔ smoke  ok:true, consoleErrorsCount:0
✔ audit  found 0 vulnerabilities
```

## File formats

ARIS Open reads and writes three interchangeable representations:

1. **ARIS AML/XML** (`.aml`, `.xml`) — the on-disk ARIS format. Structurally
   valid against the shipped `ARIS-Export.dtd`, with the full attribute set
   ARIS expects per element (`ObjDef.TypeNum`, `CxnDef.Type`, `ObjOcc.*`,
   `Position.Pos.X/Y`, …). Open in ARIS to verify round-trips.
2. **ARIS Open JSON** (`.ajos`, `.json`) — a lossless, human-readable form
   designed for version control, diffs, and programmatic use.
3. **Standalone SVG** — a self-contained, dependency-free vector image of a
   model for embedding in documents / email / wikis.

## Architecture

```
aris-open/
├─ index.html                 # single-page UI (toolbar, palette, canvas, panels, statusbar)
├─ styles.css                 # all UI styles
├─ src/
│  ├─ main.js                 # Electron: window, menu, native file dialogs, IPC
│  ├─ preload.js              # contextBridge → window.aris API (contextIsolation on)
│  ├─ renderer.js             # SVG editor UI (select/drag/connect/zoom/layout/undo/redo)
│  ├─ model.js                # data model: ObjDef, CxnDef, Model, Database
│  ├─ aml.js                  # ARIS AML XML import/export, JSON & SVG export
│  ├─ semChecks.js            # ARIS semantic check rules (EPC/org/business-rule)
│  └─ xml.js                  # zero-dep XML parser/builder (replaces fast-xml-parser)
├─ scripts/
│  ├─ generate-icons.js       # app icon generator (PNG + ICO, zero deps)
│  └─ audit-dom.js            # DOM id / window.aris wiring audit (dev check)
├─ assets/
│  ├─ icon.png                # 1024×1024 PNG (app icon)
│  ├─ icon.ico                # Windows icon (PNG-in-ICO container)
│  └─ icon-64.png             # in-app 64×64 logo
├─ test/
│  ├─ core.test.js            # model + AML + semantic checks (16 tests)
│  └─ xml.test.js
├─ package.json               # scripts, electron-builder config
├─ LICENSE                     # MIT
└─ README.md                   # this file
```

**Key design invariants:**

- **Zero runtime dependencies.** The modeling core (`model.js`, `aml.js`,
  `semChecks.js`, `xml.js`) and the renderer use only the standard library
  and `node:` modules. `electron` and `electron-builder` are *dev*
  dependencies only.
- **Strict model.** `ObjDef` / `CxnDef` / `Model` / `Database` enforces
  ARIS connection-type rules and carries `AT_*` attributes the same way ARIS
  stores them, so exports import cleanly.
- **Position round-trip.** Object coordinates are stored in `attrs` as
  `_POS_X` / `_POS_Y`, exported to `ObjOcc/Position Pos.X/Y`, and recovered
  on import — the renderer, SVG, and AML all read/write the same field.
- **Semantic rules** live in `semChecks.js` and take a model (or list of
  models), returning a violation list with ARIS severities (`ERROR`/`WARNING`
  `/INFO`) — surfaced in the **Checks** tab.
- **UI is decoupled.** The renderer talks to the engine through a small
  interface (`Database`, `Model`, `ObjDef`, `CxnDef`, `runSemanticChecks`,
  `toAmlXml`/`fromAmlXml`, `toJSON`/`fromJSON`, color tables) — swap the
  backend without touching the UI.

## The ARIS semantic-check rules (implemented)

A subset of the SHIPPED ARIS rules, reproduced from the profiles:

- **Objects must not be isolated** — every object (except process roots)
  needs ≥1 incident connection (`RULE_ORPHAN_OBJ`).
- **EPC — connection count** — functions need ≥2 in *or* ≥2 out control
  edges; events need exactly one (`RULE_EPC_CONN_COUNT`).
- **EPC — no cycles** — the control-flow graph is acyclic (`RULE_NO_CYCLE`).
- **Org — single superior** — an org unit has exactly one manager/superior
  (`RULE_ORG_SINGLE_SUPERIOR`).
- **Org — manager present** — org units reference a manager
  (`RULE_ORG_MANAGER`).
- **Business-rule checks** — a business rule connects to a function
  (`RULE_BUSIREF_CONN`).

## Keyboard shortcuts

| Key | Action |
|---|---|
| `F` / `E` / `P` / `O` / `A` / `B` | Place Function / Event / Process / Org / App / Business rule |
| `C` | Toggle Connect mode (drag from source to target) |
| `Del` | Delete selected object / connection |
| `+/−/0` | Zoom in / out / fit |
| `Ctrl+Shift+S` | Save As |
| `Ctrl+O` | Open |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / Redo |
| `Shift+F7` | Run semantic checks |
| Double-click a node | Rename |
| Scroll wheel over canvas | Zoom |

## Roadmap / open items

- [ ] Optional BPMN 2.0 full-token (BPMN gateway / sub-process) glyphs
- [ ] Drag-and-drop from ARIS into the canvas (import preview)
- [ ] Multiple simultaneous connections between the same pair (different types)
- [ ] Auto-attribute inference from connection type (e.g. `AT_CONTROLS` weight)
- [ ] i18n (English only today)
- [ ] CI: unit tests + `electron-builder` smoke on GitHub Actions (win & mac)

## Contributing

1. Fork and clone.
2. `npm install && npm test` must stay green.
3. Keep the engine **dependency-free** — if you need a new dep, discuss.
4. Add a test for any bug you fix or feature you add.
5. PRs are welcomed with a clear, focused diff and a one-line summary.

## License

MIT — see [LICENSE](LICENSE). ARIS Open is an independent, open-source
implementation inspired by the data model and semantic rules of SAP ARIS.
"ARIS" is a trademark of SAP SE; ARIS Open is not an official SAP product and
the trademark does not imply any affiliation, sponsorship, or endorsement by
SAP SE.
