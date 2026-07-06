# AI_BRIEF - ServerPilot Current Handoff

Updated: 2026-07-06

## 0. Entry
- Repo: `D:\Users\Administrator\Documents\GitHub\myapptest`.
- Branch: `main`.
- Previous delivery version: `0.5.0-beta.28` PASS.
- Current VERSION: `0.5.0-beta.31`.
- Recommended delivery version: `0.5.0-beta.31` user-smoke-required.
- Current round: beta31 same-version macOS overlay hotfix after beta31 cross-platform Key Vault backup.
- Version bump this hotfix: no; baseline already `0.5.0-beta.31`.
- Previous beta30 macOS usability commit: `efbeae2` (`fix: polish macos dialogs backup import and compose layout`).
- Previous hotfix commit: `d86fd0e` (`fix: address beta30 macos smoke issues`).
- Beta31 handoff commit: `09fa695` (`chore: finalize beta31 handoff and generated bindings`).
- Current overlay hotfix commit: `68d0c04` (`fix: complete beta31 macos overlay blocker`).

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
- Windows backup imported key vault keys are covered for SSH publickey auth resolution.
- Settings, add server, edit server, key import, and confirm dialogs now use shared glass backdrop/surface classes with low-tint blur instead of full-screen gray wash.
- Radio checked state and KeyVault/backup import remain regression-covered; this hotfix did not rewrite those paths.
- AI_BRIEF current handoff structure test is fixed.
- Docker Manager permission failures now explain that manager commands run through independent SSH exec and do not inherit terminal `su/root` state; the UI exposes current-user and non-interactive `sudo -n` retry modes.
- Light mode Docker/Settings/ServerPicker/dialog/menu surfaces now use theme tokens instead of hardcoded dark surfaces.
- Compose no longer renders the visible empty text `No Compose projects`.
- macOS workflow builds `darwin/universal` and uploads unsigned zip and dmg files under `ServerPilot-macos-unsigned`.

## 3. Explicit Non-Goals
- No Windows DPAPI behavior change.
- No Windows CMD/PowerShell behavior removal.
- No KeyVault rewrite.
- No backup schema change.
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
- Local `cd frontend && npm run verify:frontend`: passed, including type-check, 182 Vitest files / 1643 tests, 87 Playwright tests, and frontend build.
- Local `git diff --check`: passed.
- Local Windows `wails build -platform darwin/universal`: not run for this hotfix; Windows local builds do not produce the macOS app.
- GitHub Actions `Build macOS` run `28793249269`: success for commit `68d0c04246ebbb3be7c141d27af328a7f9324485`.
- Artifact: `ServerPilot-macos-unsigned`.
- Artifact contains `ServerPilot-macos-universal-unsigned.zip` and `ServerPilot-macos-universal-unsigned.dmg`.
- `ServerPilot-macos-universal-unsigned.zip` SHA-256: `752949aaef69c648e18dc916e24c5acb026b0a72b8840641172b691128d1ff94`.
- `ServerPilot-macos-universal-unsigned.dmg` SHA-256: `9d01db51a6bd500f058e084b337b548404925cfaaa60bc67530afa27b9edaf6d`.
- macOS artifact came from the GitHub Actions macOS runner.

## 5. Next
- Download or smoke-test the GitHub Actions `ServerPilot-macos-unsigned` artifact.
- Do not run Windows local `wails build -platform darwin/universal` for macOS packaging.
- Do not continue Docker, SSH/SFTP runtime, DB schema, signing/notarization, or command completion work by default.
