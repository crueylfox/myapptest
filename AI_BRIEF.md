# AI_BRIEF - ServerPilot Current Handoff

Updated: 2026-07-07

## 0. Entry
- Repo: `D:\Users\Administrator\Documents\GitHub\myapptest`.
- Branch: `main`.
- Previous delivery version: `0.5.0-beta.28` PASS.
- Current VERSION: `0.5.0-beta.31`.
- Recommended delivery version: `0.5.0-beta.31` user-smoke-required.
- Current round: beta31 same-version SFTP/local-terminal/macOS theme hotfix after beta31 cross-platform Key Vault backup.
- Version bump this hotfix: no; baseline already `0.5.0-beta.31`.
- Previous beta30 macOS usability commit: `efbeae2` (`fix: polish macos dialogs backup import and compose layout`).
- Previous hotfix commit: `d86fd0e` (`fix: address beta30 macos smoke issues`).
- Beta31 handoff commit: `09fa695` (`chore: finalize beta31 handoff and generated bindings`).
- Previous overlay hotfix commit: `68d0c04` (`fix: complete beta31 macos overlay blocker`).
- Previous overlay blocker commit: `a16ac96` (`fix: replace macos gray modal scrim with app blur overlay`).
- Current UI polish commit: `65a19b9` (`fix: polish beta31 macos dialogs and settings ui`).
- Current settings/dialog/local-terminal hotfix commit: `7dce440` (`fix: polish beta31 macos settings dialogs and local terminal`).
- Current SFTP/local-terminal/macOS theme hotfix commit: `a7ba5c2` (`fix: polish beta31 sftp local terminal and macos theme ui`).

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
- The beta31 same-version overlay blocker fix replaces the macOS-gray-scrim approach with app content blur: `.app-visual-root` is blurred/brightened while modal surfaces render outside that root, and full-screen click-catcher backdrops stay at alpha `<= 0.18`.
- The beta31 same-version UI polish extends the app blur overlay contract to Docker, Tunnel, Process, Service, Network Diagnostics, Monitor Dashboard, and Alert Center management dialogs.
- Settings duplicate child-dialog close buttons were removed where footer cancel/abandon exists; main Settings still keeps the header close action.
- Settings header action order is reset, save, close, save-and-close; save-and-close remains primary.
- General appearance options are horizontal, contain no Windows/macOS mixed hint text, and the UI font size control is a 12-18px stepper.
- Native notification copy is platform-neutral `系统原生通知`.
- Docker/Compose logs now fill available detail space without overflowing the dialog, and Docker toolbar refresh remains on the first row.
- Settings category active state now uses a visible light blue/gray active background plus highlighted icon/text.
- Duplicate header close buttons are removed from dialogs that already have footer cancel/discard actions; the main Settings page still keeps its header close action.
- macOS alert notification copy/capability is fixed: the settings UI uses macOS system notification copy, disables the unavailable native notification switch/button, and no longer exposes Windows native notification text on macOS.
- Settings active nav state is stronger and uses a full-row lightweight background rather than relying on a left indicator only.
- macOS shortcut defaults are platform-specific: copy `⌘C`, paste `⌘V`, command completion `⌘K`, history `⇧⌘H`, and common commands `⇧⌘P`.
- User-facing `Key Vault` copy in settings/backup/server-edit surfaces is changed to `密钥库`; code identifiers and data models are unchanged.
- macOS local terminal startup now uses login shell args for zsh/bash and color-capable env (`TERM=xterm-256color`, `COLORTERM=truecolor`, `CLICOLOR=1`) without changing SSH terminal behavior.
- Beta31 same-version SFTP/local-terminal/macOS theme hotfix:
  - Transfer queue popover is anchored to the workspace/window bottom-right and remains stable after resize/SFTP height changes.
  - Terminal right-click paste now falls back to Wails `ClipboardGetText()` when `navigator.clipboard.readText()` is unavailable.
  - Settings adds a preview-only macOS gray dark theme; the production dark theme setting is not replaced.
  - Settings General UI font size control is a 12-18px slider with unchanged save semantics.
  - Remote Linux and local monitor disk/mount `显示全部` defaults to checked while preserving session toggle state.
  - SFTP More menu positions from the More button, including when the bottom splitter is low.
  - Transfer queue actions use lightweight `|` separated controls.
  - Collapsed SFTP details pane keeps a visible restore entry.
  - macOS local terminal strips only the first isolated `%` line without suppressing a normal prompt or changing SSH/Windows behavior.
  - Settings left nav active state uses a stronger full-row background with distinct hover.
- Root cause note: previous blur-token/backdrop-filter changes passed computed-style checks but failed real macOS Wails visual smoke because the full-screen backdrop still washed the app into solid gray.
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
- Local focused frontend tests for SFTP transfer overlay, SFTP toolbar/details, terminal paste, local terminal, settings theme/font UI, monitor disk/mount defaults, and theme tokens: passed, 10 files / 365 tests.
- Local focused `go test ./internal/localterminal`: passed.
- Local `cd frontend && npm run verify:frontend`: passed, including type-check, 182 Vitest files / 1656 tests, 88 Playwright tests, and frontend build.
- Local `git diff --check`: passed.
- Local Windows `wails build -platform darwin/universal`: not run for this hotfix; Windows local builds do not produce the macOS app.
- GitHub Actions `Build macOS` run `28810637794`: success for commit `a7ba5c2404cb4633a6c029585ea3cc4fc6f1b71745d`.
- Artifact: `ServerPilot-macos-unsigned`.
- Artifact contains `ServerPilot-macos-universal-unsigned.zip` and `ServerPilot-macos-universal-unsigned.dmg`.
- Artifact archive `ServerPilot-macos-unsigned.zip` was downloaded by the user to Desktop for hash extraction.
- `ServerPilot-macos-universal-unsigned.zip` SHA-256: `26903FAA58EC3FC4D1165853D39224DC61B7C11B46B8A8072C53F8B5733FB5C2`.
- `ServerPilot-macos-universal-unsigned.dmg` SHA-256: `4D7F48CCFE877D5797448E4F14B76901EC150E1D1FBA945DDB1A853C6820B098`.
- macOS artifact came from the GitHub Actions macOS runner.
- Windows local `wails build -platform darwin/universal` was not run and did not produce a macOS app.

## 5. Next
- Download or smoke-test the GitHub Actions `ServerPilot-macos-unsigned` artifact.
- Do not run Windows local `wails build -platform darwin/universal` for macOS packaging.
- Use `[skip ci]` for docs-only build-record commits after a successful packaging run; if artifact download fails, stop and ask the user for the manual download path.
- Do not continue Docker, SSH/SFTP runtime, DB schema, signing/notarization, or command completion work by default.
