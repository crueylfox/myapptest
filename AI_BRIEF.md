# AI_BRIEF - ServerPilot Current Handoff

Updated: 2026-07-07

## 0. Entry
- Repo: `D:\Users\Administrator\Documents\GitHub\myapptest`.
- Branch: `main`.
- Previous delivery version: `0.5.0-beta.28` PASS.
- Current VERSION: `0.5.0-beta.40`.
- Recommended delivery version: `0.5.0-beta.40` user-smoke-required.
- Current round: beta40 glass visual V3/V4 packaging after beta31 cross-platform Key Vault backup and beta39 glass token rollout.
- Version bump this packaging round: yes; `0.5.0-beta.39` -> `0.5.0-beta.40` before repackaging.
- Previous beta30 macOS usability commit: `efbeae2` (`fix: polish macos dialogs backup import and compose layout`).
- Beta31 handoff commit: `09fa695` (`chore: finalize beta31 handoff and generated bindings`).

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
  - Production dark theme now uses the macOS gray/graphite palette directly instead of a preview-only macOS gray theme.
  - Legacy `macos_gray_dark` preview requests are treated as the production dark theme for compatibility.
  - Settings General UI font size control is a 12-18px slider with visible tick marks and unchanged save semantics.
  - Remote Linux and local monitor disk/mount `显示全部` defaults to checked while preserving session toggle state.
  - SFTP More menu positions from the More button, including when the bottom splitter is low.
  - Transfer queue actions use lightweight `|` separated controls.
  - Collapsed SFTP details pane keeps a visible restore entry.
  - macOS local terminal strips only the first isolated `%` line without suppressing a normal prompt or changing SSH/Windows behavior.
  - Settings left nav active state uses a stronger full-row background with distinct hover.
- Beta31 same-version SFTP/terminal theme UI blocker completion:
  - SFTP More menu and transfer queue use bottom anchoring when placed above/at the workspace bottom, so short menus stay attached at low SFTP heights.
  - Production dark theme and default `serverpilot-dark` terminal profile now use the same graphite/Codex-like background instead of the legacy deep blue terminal background.
  - Transfer queue `|` separators are independent DOM elements, so active tab backgrounds no longer cover the separator.
  - Settings radio policy options use full-surface checked styling, not a left-marker-only active state.
  - macOS local terminal initial `%` stripping handles split output chunks without changing SSH terminal behavior.
- Beta31 same-version terminal/theme/queue follow-up keeps the transfer queue above the status bar, strengthens the Codex-like blue accent on graphite surfaces, fixes command-completion keyboard auto-scroll, aligns font-size slider ticks with the track, and handles ANSI-prefixed stray macOS `%` prompts.
- Beta32 terminal layout/density/color hotfix covered Command button reclamp, SFTP density, font slider ticks, macOS `%` prompt stripping, graphite terminal colors, and compact monitor density.
- Beta36 macOS native font/titlebar hotfix:
  - macOS UI font stack uses Apple system/SF/PingFang/Helvetica fallbacks through platform-specific CSS variables.
  - macOS terminal default font stack uses the native monospace CSS token while custom terminal fonts remain unchanged.
  - Wails macOS window config uses native hidden/inset titlebar chrome so traffic-light buttons remain native.
  - App shell exposes platform class/data attributes and reserves a macOS traffic-light safe zone for top toolbar content.
  - Wails drag regions are limited to the macOS top background/toolbar; interactive controls, terminals, SFTP, and splitters are no-drag.
- Beta37 macOS terminal tab alignment hotfix:
  - macOS traffic-light safe-zone padding is scoped to the non-terminal app topbar.
  - Terminal workspace tabs inside the SSH area keep `padding-left: 0`, so the first SSH tab starts at the left edge of the SSH workspace.
- Beta38 macOS monitor sidebar titlebar safe-zone hotfix:
  - macOS terminal-layout left monitor sidebars reserve the native titlebar height at the container level.
  - Remote/local monitor scroll content no longer scrolls underneath the native red/yellow/green window buttons.
- Beta39 glass visual V1/V2 hotfix:
  - `style.css` defines shared glass backdrop, surface, panel, card, border, shadow, blur, and header tokens for dark/light themes.
  - Tunnel, Docker, Process, and Service manager dialog CSS consumes shared glass tokens for shell, header/toolbar, panels, and cards.
  - This round only changes UI surface CSS and tests; no event, store, API, data-flow, polling, connection, or filtering logic changed.
- Beta40 glass visual V3/V4 packaging:
  - Alert Center, Multi-server Dashboard, Network Details, SFTP properties/editor, editor More menu, and Network Diagnostics surfaces consume shared glass tokens.
  - macOS collapsed local/SSH workspace topbar restores the traffic-light safe-left padding so tabs do not sit under native window buttons.
  - This round remains UI surface CSS/tests only; no event, store, API, data-flow, polling, connection, or filtering logic changed.
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
- Local focused beta39 regression tests for glass tokens and manager dialog CSS adoption: passed.
- Local `cd frontend && npm run verify:frontend`: passed, including type-check, 183 Vitest files / 1679 tests, 89 Playwright tests, and frontend build.
- Local `git diff --check`: passed.
- Local Windows `wails build`: passed and produced the Windows EXE only.
- Beta40 Windows EXE copied to `D:\Users\Administrator\Desktop\ServerPilot-v0.5.0-beta.40.exe`.
- Beta40 Windows EXE SHA-256: `F8A092C93F4E21CBBB878135D83B8683CE6CB313367CE1B595632819E7848AC9`.
- Local Windows `wails build -platform darwin/universal` was not run and did not produce a macOS app.
- GitHub Actions `Build macOS` run `28856250391`: success for commit `24f6ad52a951f7c5f3b0d806bbd81af3c5c009bb`.
- Artifact: `ServerPilot-macos-unsigned`.
- Artifact API digest: `sha256:4e38a6f3dd1a207efef623d672baee1f776904cb2ab81e057e847c3e07a3e16e`.
- Artifact contains `ServerPilot-macos-universal-unsigned.zip`, `ServerPilot-macos-universal-unsigned.dmg`, and their `.sha256` files.
- macOS artifact came from the GitHub Actions macOS runner.

## 5. Next
- For any future user-deliverable repackaging, bump the version first; do not create another same-version package.
- Do not run Windows local `wails build -platform darwin/universal` for macOS packaging.
- Use `[skip ci]` for docs-only build-record commits after a successful packaging run; if artifact download fails, stop and ask the user for the manual download path.
- Do not continue Docker, SSH/SFTP runtime, DB schema, signing/notarization, or command completion work by default.
