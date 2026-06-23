---
name: tarot-release
description: Use when packaging, building, or releasing the tarot Electron app - building the Windows portable/nsis or macOS dmg, bumping the version, or diagnosing the better-sqlite3 native-module ABI crash in a portable build. Do NOT use for routine dev or test-only changes.
---

# Tarot Release & Packaging

The procedure for shipping the tarot Electron app without the native-module crash
that has broken portable builds before. Run these steps in order from
`C:\Users\Matt\projects\tarot`. ASCII only.

The whole point of this checklist is step 2: `better-sqlite3` is a native module
compiled against a specific ABI. Node and Electron use different ABIs, so a build
that runs fine under `node server.js` will crash the packaged app on its first
database call unless the module is rebuilt for Electron. The `dist:*` scripts
already chain the rebuild, but verify it - do not assume.

## 1. Pre-flight: tests must be green

Run the full suite first. A red suite never gets packaged.

```
cd C:/Users/Matt/projects/tarot && node --test
```

Expected: all tests pass (the suite is ~150 cases across `tests/*.test.js`,
auto-discovered). Note: pass a directory like `node --test tests/` and this Node
reports a single synthetic failure - use bare `node --test` (or the quoted glob
`node --test "tests/**/*.test.js"`). Fix failures before going further.

## 2. Native rebuild for Electron's ABI

Rebuild `better-sqlite3` against Electron's ABI:

```
npm run rebuild
```

(That runs `electron-rebuild -f -w better-sqlite3`.)

**Verify it actually worked - this is the step that prevents the crash.** A
passing `node -e "require('better-sqlite3')"` proves nothing here, because Node's
ABI differs from Electron's. The only valid proof is launching the packaged app
(step 5) and confirming a DB call succeeds. Failure signature: the app starts but
crashes the moment it touches `memory.db` / `interpretations.db`, typically with a
"NODE_MODULE_VERSION" / "was compiled against a different Node.js version" error.

## 3. Bump the version

Edit `version` in `package.json` (semver). The portable artifact name embeds it
(`Tarot-Oracle-Portable-${version}.exe`), so this must happen before the build.

## 4. Build the artifacts

Windows (produces nsis installer + portable exe, x64):

```
npm run dist:win
```

macOS (produces dmg, arm64 + x64):

```
npm run dist:dmg
```

Both scripts run `npm run rebuild` first, then `electron-builder`. Artifacts land
in `dist/`.

## 5. Smoke test the packaged build

Do not declare done on a build you have not run. Launch the artifact (the portable
exe is fastest) and confirm:

1. The app window opens.
2. Perform a reading - an interpretation renders.
3. The DB write path works: confirm `memory.db` updates (a reading is saved /
   recalled). This is the real proof the ABI rebuild took.
4. Check both interpretation paths if reachable: the Claude API path and the
   Ollama fallback path. The offline card meanings in `data/*.json` must render
   even with no API.

## 6. Why the rebuild is mandatory (lesson)

Portable builds have shipped before that ran in dev and crashed on launch for end
users, because `better-sqlite3` was compiled for Node's ABI, not Electron's. The
`dist:*` scripts now chain `npm run rebuild`, and `npmRebuild` is set to false in
the build config so electron-builder does not undo it. Treat step 2's verification
and step 5's smoke test as non-skippable: a green dev run is not evidence the
packaged app works.
