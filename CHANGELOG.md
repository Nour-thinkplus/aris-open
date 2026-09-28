# Changelog

All notable changes to **ARIS Open** are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-09-28

First public release of the clean-room ARIS re-implementation.

### Added
- **Desktop app** (Electron, context-isolated) with SVG canvas editor:
  place Function / Event / Process / Org-unit / App-system / Business-rule,
  connect them with ARIS connection types (`CT_CONTROLS`, `CT_IS_PRCSNT_SUPER`,
  `CT_IS_PERFORMED_BY`, `CT_IS_SUPPORTED_BY`, `CT_IS_ACCESSIBLE`, …),
  drag / select / delete / rename (double-click), zoom / pan / fit,
  multi-select, auto-layout, and full **Undo / Redo** via lossless snapshots.
- **Multi-model database** — many models per file, per-model view type
  (EPC / ORG / BPMN / PROC), models listed in the Models panel, switch,
  create, rename, delete.
- **ARIS AML / XML import & export** (DTD-compatible attributes:
  `ObjDef.TypeNum`, `CxnDef.Type`, `ObjOcc.*`, `Position.Pos.X/Y`, `AT_*`),
  so models move to and from ARIS without conversion.
- **ARIS semantic check engine** (`semChecks.js`) — rule subsets for
  orphan objects, EPC connection-count, EPC acyclicity,
  org-unit single-superior, org-unit manager presence, business-rule
  connection. Severities 5/4/3 (error/warning/info) as in ARIS.
  Results in the **Checks** tab with rule name + target object.
- **JSON model** (`.ajos`/`.json`) — human-readable, VCS-friendly, lossless.
- **SVG export** for standalone embedding.
- **16 unit tests** (`node --test`) covering model/JSON/AML round-trip,
  SVG export, semantic checks, and the zero-dep XML engine.
- **electron-builder config** for:
  - macOS **universal** (x64 + arm64) DMG + ZIP
  - Windows x64 **NSIS** installer (choose install dir, desktop shortcut,
    per-user)
  - Linux AppImage + .deb (best-effort cross-build)
- `npm audit` **0 vulnerabilities** (Electron **44.4.5**, electron-builder
  **26.17.0**).
- Zero **runtime** JS dependencies — the modeling core
  (`model.js`, `aml.js`, `semChecks.js`, `xml.js`) and the renderer are
  pure standard-library + `node:` modules. `electron` and
  `electron-builder` are *dev* dependencies only.

### Changed / infrastructure
- Electron **44.4.5** (was 33.3.1 at project start; 38.8.6 mid-project).
- App icon at **1024×1024** for macOS `.icns` (electron-builder requirement)
  + 256-in-ICO for Windows.
- `scripts/generate-icons.js` (zero-dep PNG/ICO writer) and
  `scripts/web-server.js` for optional browser-based dev.
- `.gitignore`, `package-lock.json`, `LICENSE` (MIT), `README.md`,
  `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`.

### Known limitations / v0.2 ideas
- No **code signature / notarization** on macOS (Apple Developer ID needed);
  first launch on macOS: *right-click → Open*.
- Windows exe is **unsigned** (optional: add a CodeSign cert + OSS signer).
- No *auto-update* yet — wire `electron-updater` with a feed.
- No *i18n* yet (English only).
- Semantic check rule set is a **portable subset** of ARIS — the full
  profile set (100+ rules) is on the roadmap.

[0.1.0]: https://github.com/aris-open/aris-open/releases/tag/v0.1.0
