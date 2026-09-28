# Contributing to ARIS Open

Thanks for considering a contribution. This is a deliberately-small,
easy-to-read codebase: **one HTML page, ~7 plain-ESM JS files**, no
runtime dependencies, and `node:test` for unit tests.

- **Code style:** follow the existing style — no enforced formatter,
  keep modules small, use `node:` imports, ES modules (`"type":"module"`
  in `package.json`). No TypeScript, no build step for the app core.
- **Tests:** every new rule in `semChecks.js`, model change in `model.js`,
  or AML shape change in `aml.js` should come with a test in `test/`.
  Run `npm test` (no extra install needed).
- **New dependency rule:** runtime deps are *zero*. A PR adding a runtime
  dependency should justify why it can't be written in ~40 lines of ESM.
  Dev dependencies (build tooling) require a shorter justification.
- **New connection type / type number:** extend the tables in
  `model.js` (`TYPES`, `CXN_TYPES`, `AT_*`), add a test in
  `test/core.test.js` that asserts the AML export/import round-trip.
- **Security:** keep `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true` in `src/main.js`. New IPC in `preload.js` should be
  small, typed-ish (documented params), and validate in the main process.
  Do not use `exec`/`spawn` in the renderer.
- **Releases:** bump `version` in `package.json`, add a `CHANGELOG.md`
  entry, then `npm run dist:mac && npm run dist:win` on a clean `main`
  (or use the GitHub Actions workflow).

## Branches

- `main` — always release-ready.
- `feature/*`, `fix/*` — short-lived; PR into `main`.

## Commits

Conventional-style is preferred (`feat:`, `fix:`, `docs:`, `test:`,
`chore:`, `build:`). Not enforced by the repo, but makes `git log`
useful.
