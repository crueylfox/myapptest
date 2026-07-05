# AI_BRIEF - ServerPilot Current Handoff

Updated: 2026-07-06

## 0. Entry
- Repo: `C:\Users\Administrator\Documents\Codex\2026-06-13\ssh-serverpilot-windows-11-x64-go`.
- Branch: `master`.
- Previous delivery version: `0.5.0-beta.28` PASS.
- Current VERSION: `0.5.0-beta.29`.
- Current round: beta29 security / backup / key vault hardening.
- Recommended delivery version: `0.5.0-beta.29` user-smoke-required.
- Version bump: `0.5.0-beta.28` -> `0.5.0-beta.29`.
- EXE path: `C:\Users\Administrator\Documents\Codex\2026-06-13\ssh-serverpilot-windows-11-x64-go\build\bin\ServerPilot.exe`.
- SHA-256: `0DF8D6EE0B1EB0E0F605A87F3C4C1C9B96118F8785286A96C145FB6A155091D7`.

## 1. Beta28 Pass Lock
- User smoke passed for beta28.
- Beta28 is recorded as multi-view UI unification + table interaction fix, including same-version Docker container terminal connect hotfix.
- Beta28 EXE SHA-256: `8319638EA80E622CFC6115D38E6D4394B733F0D1D9FA31E5395E0D961B32641F`.

## 2. Beta29 Scope
- Beta29 is a security / backup / key vault hardening round.
- No new user-facing feature is added.
- Added regression coverage for:
  - Backup schema excluding terminal output, remote file content, local file content, and Docker/container logs.
  - Key Vault private-key validation errors not echoing passphrase input.
  - Settings security surfaces: command history limit, SSH host key policy, SSH timeout, keepalive, terminal profile, and SSH command completion settings.
  - Backup / restore invalid-error visibility and import option layout.
  - Key Vault list/edit entry points and masked secret UI.
  - `npm run smoke:ui` settings scroll coverage across security, backup, and key vault pages.

## 3. Explicit Non-Goals
- No backend runtime change.
- No SSH/SFTP runtime change.
- No SSH PTY, `WriteTerminal`, `terminalSessionID`, or `DisconnectServer` change.
- No DB schema change.
- No Wails API model change.
- No Docker destructive action.
- No Docker new feature.
- No Local Explorer write operation.
- No command completion enhancement.
- No SecretStore / Backup data format change.
- No real secret, private key, terminal output, file content, or Docker logs are recorded in tests or this handoff.

## 4. Validation
- Focused Go `go test ./internal/backup ./internal/keyvault ./internal/secretstore ./internal/credential`: passed.
- Focused Vitest for Settings / Backup / Key Vault / handoff / smoke fixtures: passed, 7 files and 84 tests.
- Focused Playwright settings security / backup / key vault smoke path: passed, 1 test.
- `npm run smoke:ui`: passed, 6 tests.
- `cd frontend && cmd.exe /c npm run verify:frontend`: passed, including type-check, 181 Vitest files / 1626 tests, 83 Playwright tests, and frontend build.
- `go vet ./...`: passed.
- `go test ./...`: passed.
- `git diff --check`: passed.
- `wails build`: passed.
- EXE SHA-256: `0DF8D6EE0B1EB0E0F605A87F3C4C1C9B96118F8785286A96C145FB6A155091D7`.

## 5. Next
- Finish beta29 verification and user smoke.
- Do not continue Docker, Local Explorer write operation, command completion, SSH runtime, or DB schema work by default.
