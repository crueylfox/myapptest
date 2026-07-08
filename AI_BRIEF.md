# AI_BRIEF - ServerPilot Current Handoff

Updated: 2026-07-09

## 0. Entry
- Repo: `D:\Users\Administrator\Documents\GitHub\myapptest`.
- Branch: `main`.
- Previous delivery version: `0.5.0-beta.28` PASS.
- Current VERSION: `0.5.0-beta.50`.
- Recommended delivery version: `0.5.0-beta.50` user-smoke-required.
- Current round: beta50 macOS sidebar/shortcut/terminal UI package after beta49 splitter gutter package and beta31 cross-platform Key Vault backup.
- Version bump this packaging round: yes; `0.5.0-beta.49` -> `0.5.0-beta.50` before repackaging.

## 1. Beta28 Pass Lock
- User smoke passed for beta28.
- Beta28 is recorded as multi-view UI unification + table interaction fix, including same-version Docker container terminal connect hotfix.

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
- Beta41 material visual package:
  - Shared material tokens and `.app-material-*` classes are the primary UI surface contract; `.app-glass-*` remains as a compatibility alias.
  - Alert Center, Multi-server Dashboard, Network Details, SFTP properties/editor, editor More menu, Network Diagnostics, manager dialogs, Settings, connection dialogs, and app dialog surfaces consume the material/glass-compatible stack.
  - The global blue accent and terminal default blue are deepened to `#3f7dff`; this round remains UI surface CSS/tests only.
- Beta42 canonical surface token package:
  - Docker, Tunnel, Process, and Service manager inner panel CSS now consumes canonical `--surface-*` and `--state-*` tokens directly instead of legacy `--material-*` compatibility aliases.
  - The global blue accent is deepened from `#3f7dff` to `#2f6df2` for dark/macOS-gray themes and to `#1f5fd8` for light mode.
  - This round remains UI surface CSS/tests only; no event, store, API, data-flow, polling, connection, filtering, schema, SSH/SFTP runtime, or KeyVault logic changed.
- Beta49 removes visible splitter gutter bands: splitter hit areas are transparent, 0px layout tracks; visible hairlines are drawn by adjacent pane borders.
- Beta50 adjusts the visible monitor-sidebar toggle placement, removes the top-right menu chevron, accepts macOS shortcut bindings with a disable-and-save conflict fallback, stabilizes the command-history floating button size, enlarges macOS terminal Profile number spinners, and forces Ctrl/Meta wheel to terminal font-size zoom without xterm font-weight drift.
- Root cause note: previous blur-token/backdrop-filter changes passed computed-style checks but failed real macOS Wails visual smoke because the full-screen backdrop still washed the app into solid gray.
- Radio checked state and KeyVault/backup import remain regression-covered; this hotfix did not rewrite those paths.
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
- Local `cd frontend && npm run verify:frontend`: passed, including type-check, 186 Vitest files / 1715 tests, 89 Playwright tests, and frontend build.
- Local `git diff --check`: passed.
- Local Windows `wails build`: passed and produced the Windows EXE only.
- Beta50 Windows EXE copied to `D:\Users\Administrator\Desktop\ServerPilot-v0.5.0-beta.50.exe`.
- Beta50 Windows EXE SHA-256: `9D3536776F7F38E4D5621950AB682ECC59AA6CBBEBA05745B75E8B6A48EA5A71`.
- Local Windows `wails build -platform darwin/universal` was not run and did not produce a macOS app.
- GitHub Actions beta50 `Build macOS` run `28963923526`: success for commit `d613a8cd6be2c685be0ffcc68c2d0811606075d6`.
- Artifact: `ServerPilot-macos-unsigned`, size `31523205` bytes.
- Artifact SHA-256: not calculated because the artifact was not downloaded in this run.
- macOS artifact came from the GitHub Actions macOS runner.

## 5. Next
- For any future user-deliverable repackaging, bump the version first; do not create another same-version package.
- Do not run Windows local `wails build -platform darwin/universal` for macOS packaging.
- Use `[skip ci]` for docs-only build-record commits after a successful packaging run; if artifact download fails, stop and ask the user for the manual download path.
- Do not continue Docker, SSH/SFTP runtime, DB schema, signing/notarization, or command completion work by default.
