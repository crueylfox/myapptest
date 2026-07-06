# AI_BRIEF - ServerPilot Current Handoff

Updated: 2026-07-06

## 0. Entry
- Repo: `C:\Users\Administrator\Documents\Codex\2026-06-13\ssh-serverpilot-windows-11-x64-go`.
- Branch: `master`.
- Previous delivery version: `0.5.0-beta.28` PASS.
- Current VERSION: `0.5.0-beta.30`.
- Current round: beta30 macOS usability adaptation.
- Recommended delivery version: `0.5.0-beta.30` user-smoke-required.
- Version bump: `0.5.0-beta.29` -> `0.5.0-beta.30`.

## 1. Beta28 Pass Lock
- User smoke passed for beta28.
- Beta28 is recorded as multi-view UI unification + table interaction fix, including same-version Docker container terminal connect hotfix.
- Beta28 EXE SHA-256: `8319638EA80E622CFC6115D38E6D4394B733F0D1D9FA31E5395E0D961B32641F`.

## 2. Beta30 Scope
- macOS SecretStore uses Keychain for server passwords.
- macOS KeyVault protector stores the application master key in Keychain and encrypts private-key material locally.
- Windows backup restore keeps non-sensitive config and reports DPAPI-bound credential warnings instead of silently dropping data.
- macOS local terminal is a single `本地终端` entry with `$SHELL`, `/bin/zsh`, then `/bin/bash` resolution.
- macOS local monitor and local file manager cover the MVP resource/file workflows without Windows CMD/PowerShell labels.
- Dark radio checked state and macOS WebView menu/settings blur surfaces have regression coverage.
- macOS workflow builds `darwin/universal` and uploads `ServerPilot-macos-unsigned`.

## 3. Explicit Non-Goals
- No Windows DPAPI behavior change.
- No Windows CMD/PowerShell behavior removal.
- No SSH/SFTP remote runtime change.
- No SSH PTY, `WriteTerminal`, `terminalSessionID`, or `DisconnectServer` change.
- No DB schema change.
- No Docker new feature.
- No macOS signing or notarization.
- No command completion enhancement.
- No real secret, private key, terminal output, file content, or Docker logs are recorded in tests or this handoff.

## 4. Validation
- `go test ./...`: passed.
- `cd frontend && npm run verify:frontend`: passed, including type-check, 182 Vitest files / 1636 tests, 86 Playwright tests, and frontend build.
- `git diff --check`: passed.
- `wails build`: passed.

## 5. Next
- Wait for GitHub Actions macOS build result and user smoke.
- Do not continue Docker, SSH/SFTP runtime, DB schema, signing/notarization, or command completion work by default.
