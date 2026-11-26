# Nexa Setup

A custom per-user Windows 11 installer for the Nexa desktop workspace. The renderer uses plain HTML, CSS, and JavaScript. Installation, payload validation, registry access, shortcuts, and uninstall logic run in the Electron main process.

## Link the current harness

This project lives in `setup/` inside the Nexa monorepo. From the repository root, run:

```bash
npm install
npm --prefix setup install
npm run setup
```

The command builds the current harness, packages an x64 Electron app, verifies `app.asar` and its runtime dependencies, launches the packaged app with `--smoke`, creates and validates `payload/nexa-harness.zip`, and builds `release/NexaSetup.exe`. It also keeps a verified app copy in `build/nexa`.

The bridge accepts an explicit harness path when run from this setup project:

```bash
npm --prefix setup run link -- ..
```

It also accepts an absolute path:

```bash
npm --prefix setup run link -- "C:\path\to\nexa-harness"
```

Only `zod`, `electron-updater`, and their transitive dependencies are copied into the packaged app. Development files and environment files are excluded. Provider credentials are never added to the installer payload.

## Develop the setup

```bash
npm install
npm run dev
```

`npm run dev` uses the embedded development sample. To create a development payload from `assets/dev-sample`:

```bash
npm run payload -- "assets/dev-sample" --name "Nexa Sample" --version 0.0.0-dev --dev
```

A packaged setup fails safely if its payload is absent. Do not pass `--dev` for a release build.

## Assets and interface

`leaf.svg` is the minimalist Nexa leaf. `npm run build:assets` copies Inter and Geist Mono locally and generates the Windows ICO, macOS ICNS, and PNG variants. The packaged installer works offline and does not fetch brand assets at runtime.

The renderer includes welcome, customize, progress, completion, error, uninstall confirmation, and removal screens. It supports keyboard navigation, focus trapping, reduced motion, path validation, cancellation, and a WebGL background with a 2D fallback.

## Install behavior

The default location is `%LOCALAPPDATA%\Programs\Nexa`. Installation requires no elevation. The payload SHA-256 and size are checked before extraction. ZIP entries are validated against traversal, absolute paths, Windows reserved names, and containment violations. Files are staged beside the destination and the previous installation is restored if the swap fails.

The installer creates the selected desktop and Start menu shortcuts, registers an HKCU uninstall entry, and copies the portable setup executable as `uninstall.exe`. Shortcuts use the `nexa.desktop` AppUserModelId, matching the harness.

Uninstall removes only files listed in the owned install manifest. Settings and data are preserved unless the user explicitly selects removal. The matching data folders are `%APPDATA%\nexa` and `%LOCALAPPDATA%\nexa`.

Silent install:

```bash
NexaSetup.exe /S
NexaSetup.exe /S /D="C:\Users\You\AppData\Local\Programs\Nexa"
```

`/D` must be last because its value consumes the remainder of the command line. `--silent` is also accepted. Silent installation creates desktop and Start menu shortcuts and does not launch Nexa. Exit codes are `0` for success, `1` for failure, and `2` for cancellation.

Uninstall:

```bash
"C:\Users\You\AppData\Local\Programs\Nexa\uninstall.exe" --uninstall
```

The setup log is written to `%TEMP%\nexa-setup.log`.

## Verification

```bash
npm run test:contract
npm test
```

To test a packaged setup instead of the source checkout:

```bash
set NEXA_SETUP_EXE=C:\path\to\NexaSetup.exe
npm test
```

The smoke test refuses to overwrite an existing Nexa uninstall entry. It installs into a unique temporary folder with shortcuts and auto-launch disabled, verifies the manifest and registry values, launches a release payload with an isolated profile, checks for `NEXA_SMOKE_OK`, uninstalls through the UI, confirms cleanup and cancellation exit code 2, and verifies that existing Nexa settings are unchanged.

Before distribution, test upgrades, rollback, cancellation during extraction, corrupted payloads, running-app handling, paths with spaces and Unicode, shortcut creation, signing, and the portable launcher on a clean Windows 11 account. Automatic app updates require a separately configured HTTPS update feed.
