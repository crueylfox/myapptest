# AI_BRIEF - ServerPilot Current Handoff

Updated: 2026-07-06

## 0. Entry
- Repo: `D:\Users\Administrator\Documents\GitHub\myapptest`.
- Branch: `main`.
- Previous delivery version: `0.5.0-beta.28` PASS.
- Current VERSION: `0.5.0-beta.30`.
- Recommended delivery version: `0.5.0-beta.30` user-smoke-required.
- Current round: beta30 macOS usability adaptation / same-version blocker hotfix.
- Version bump this round: no.
- Previous beta30 macOS usability commit: `efbeae2` (`fix: polish macos dialogs backup import and compose layout`).
- Current hotfix commit: `d86fd0e` (`fix: address beta30 macos smoke issues`).

## 1. Beta28 Pass Lock
- User smoke passed for beta28.
- Beta28 is recorded as multi-view UI unification + table interaction fix, including same-version Docker container terminal connect hotfix.
- Beta28 EXE SHA-256: `8319638EA80E622CFC6115D38E6D4394B733F0D1D9FA31E5395E0D961B32641F`.

## 2. Beta30 macOS Scope
- macOS SecretStore uses Keychain for server passwords.
- macOS KeyVault protector stores the application master key in Keychain and encrypts private-key material locally.
- Windows backup restore keeps non-sensitive config and reports DPAPI-bound credential warnings instead of silently dropping data.
- Windows backup imports now preserve legacy key vault private-key auth mapping so restored servers resolve to publickey auth when the key material is restorable.
- macOS local terminal is a single `本地终端` entry with `$SHELL`, `/bin/zsh`, then `/bin/bash` resolution.
- macOS local monitor and local file manager cover the MVP resource/file workflows without Windows CMD/PowerShell labels.
- Dark radio checked state and macOS WebView menu/settings blur surfaces have regression coverage.
- Dark/light radio checked states and AppDialogHost/Docker/modal blur surfaces are covered by computed-style smoke tests.
- Docker Manager permission failures now explain that manager commands run through independent SSH exec and do not inherit terminal `su/root` state; the UI exposes current-user and non-interactive `sudo -n` retry modes.
- Light mode Docker/Settings/ServerPicker/dialog/menu surfaces now use theme tokens instead of hardcoded dark surfaces.
- Compose no longer renders the visible empty text `No Compose projects`.
- macOS workflow builds `darwin/universal` and uploads unsigned zip and dmg files under `ServerPilot-macos-unsigned`.

## 3. Explicit Non-Goals
- No Windows DPAPI behavior change.
- No Windows CMD/PowerShell behavior removal.
- No SSH/SFTP remote runtime change.
- No SSH PTY, `WriteTerminal`, `terminalSessionID`, or `DisconnectServer` change.
- No DB schema change.
- No Docker destructive action.
- No Docker new feature outside the requested permission retry path.
- No macOS signing or notarization.
- No command completion enhancement.
- No real secret, private key, passphrase, backup content, terminal output, local file content, or Docker logs are recorded in tests or this handoff.

## 4. Validation
- Local `go test ./...`: passed.
- Local `cd frontend && npm run verify:frontend`: passed, including type-check, 182 Vitest files / 1641 tests, 86 Playwright tests, and frontend build.
- Local `git diff --check`: passed.
- Local Windows `wails build -platform darwin/universal`: not run for this hotfix; Windows local builds do not produce the macOS app.
- GitHub Actions `Build macOS` run `28777909387`: success for commit `d86fd0e9cba0664a8fd50116fd25302490966820`.
- Artifact: `ServerPilot-macos-unsigned`.
- Artifact contains `ServerPilot-macos-universal-unsigned.zip` and `ServerPilot-macos-universal-unsigned.dmg`.
- `ServerPilot-macos-universal-unsigned.zip` SHA-256: `74fa801c78d8e4dae2696d8fa096783244117540f494a5d7e60ab14f4a0db32a`.
- `ServerPilot-macos-universal-unsigned.dmg` SHA-256: `eb67f54feee5cb7dbc85a2a2c1a61a39e170564f361809881a803a479e27db5a`.
- GitHub Actions artifact digest: `sha256:c5dae0c9f21aa560d07c373695407140a3f30899d884d79f1bcec8e56b922c40`.
- macOS artifact came from the GitHub Actions macOS runner.

## 5. Next
- Download or smoke-test the GitHub Actions `ServerPilot-macos-unsigned` artifact.
- Do not run Windows local `wails build -platform darwin/universal` for macOS packaging.
- Do not continue Docker, SSH/SFTP runtime, DB schema, signing/notarization, or command completion work by default.
