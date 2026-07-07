# ServerPilot Agent Instructions

中文主文档：`Codex开发规则.md`。

This file is a compatibility entry for Codex and other agent tools. Read it
first, then follow `Codex开发规则.md`, `架构说明.md`, and `安全边界.md` as the
source of truth.

Minimum hard constraints:

- Do not modify SSH runtime architecture, SSH Terminal PTY lifecycle,
  `terminalSessionID`, `WriteTerminal`, or `DisconnectServer(serverID)`.
- Keep SSH / Terminal / Monitor / SFTP / SCP / Tunnel / Docker / Process /
  Service Manager / Network Details / Network Diagnostics / Local Terminal
  runtimes isolated.
- Use typed Wails APIs; do not use `map[string]interface{}` as application API
  contracts.
- Do not let plaintext secrets enter SQLite, logs, frontend state, Wails
  events, Toasts, test snapshots, or source code.
- Key Vault may store private-key material only as Windows/user-level protected
  ciphertext plus metadata. It must never store plaintext private keys or
  passphrases.
- Server profiles store a Key Vault `key_vault_id`; one key may be reused by
  multiple servers without duplicating plaintext key material.
- `SecretStore` remains the boundary for passwords and private-key
  passphrases.
- Backup/export must not include Key Vault protected blobs, plaintext private
  keys, private-key passphrases, or SecretStore keys unless a future dedicated
  encrypted Key Vault export design explicitly changes that rule.
- Do not delete tests or weaken validation to make a build pass.
- Do not create `outputs/`, `work/`, or `temp/` cleanup artifacts during
  finalization.

Post-build finalization:

- Chinese documents are the source of truth.
- Use `scripts/finalize-after-build.ps1` to sync English compatibility files.
- Current tasks sync only `当前轮次状态.md -> AI_BRIEF.md` and
  `开发进展.md -> DEV_PROGRESS.md`.
- Milestones may also sync `项目交接.md -> HANDOFF.md` and
  `路线图.md -> ROADMAP.md`.
- Rules changes may sync `架构说明.md -> ARCHITECTURE.md` and
  `安全边界.md -> SECURITY.md`; `AGENTS.md` remains this compatibility entry.
- After successful code validation and `wails build`, do not rerun full Go/npm/
  Wails validation just because Markdown sync changed docs.
- After a successful GitHub Actions packaging commit has produced the required
  macOS artifact, follow-up docs-only commits that only record build status,
  artifact names, or SHA-256 values must include `[skip ci]` in the commit
  message. Do not trigger a second macOS packaging run for docs-only records.
- If downloading a GitHub Actions artifact fails, stalls, or repeatedly times
  out, stop the artifact-download work and ask the user where they manually
  downloaded the file. Do not keep retrying with alternate download methods.
- Compute the EXE SHA-256 once and reuse that result in docs/final response.
- Keep `AI_BRIEF.md` within 120 lines.

Frontend UI regression rules:

- Any change touching popovers, dropdowns, context menus, toolbars, bottom status overlays, dialogs, side panels, split panes, or responsive layout must include UI contract tests.
- Tests must cover narrow width, overflow, outside-click/Escape behavior, Teleport/z-index if applicable, and disabled/active visual states when relevant.
- Do not rely only on class existence when the bug is visual placement or wrapping; assert the CSS contract or placement helper behavior.
- Prefer shared popover/positioning helpers over one-off left/top calculations.
- Buttons in compact toolbars must not wrap text unless explicitly designed.
- Popovers must clamp to viewport and use internal scrolling when content is larger than available space.
- Avoid absolute/negative-margin/transform/large `!important` hacks for normal layout.
- Screenshots from user reports override assumptions from DOM-only tests.

YAGNI / minimal-change rule:

- If a correct one-line or small local change fully satisfies the requirement, prefer that over adding new abstractions.
- Do not introduce composables, helpers, services, interfaces, event buses, registries, or generalized frameworks unless the current code has real repetition, a real boundary problem, or an imminent tested use case.
- Prefer the smallest behavior-preserving change that passes tests and respects project boundaries.
- Do not use YAGNI as an excuse to skip tests, ignore user requirements, hide failures, or leave known regressions.
- When choosing between a one-line fix and a new abstraction, document the reason only if the abstraction is actually necessary.

Large refactor mode:

- Enter large-refactor mode when the user explicitly asks for "大量重构", "多改点", "加快重构", or "不要只做一点点".
- In large-refactor mode, the task must have an explicit must-do list; candidate ideas are not accomplishments.
- Do not satisfy large-refactor mode with thin wrappers. The change must actually reduce the target god-file responsibilities.
- Keep each large-refactor round inside one risk area; do not mix unrelated modules into the same round.
- The final response must report the target file line count before and after, reduced responsibilities, retained responsibilities, unfinished items, and the reason for any unfinished items.
- Do not sacrifice tests, skip failures, comment out failing tests, or weaken assertions to make a large refactor look successful.
- YAGNI still applies: do not abstract for abstraction's sake. But when the user explicitly asks for large refactoring, do not use YAGNI to avoid existing god-file governance.

Version bump rule:

- Any development round that produces a new user-deliverable package or
  installer must bump the application version in the same commit before
  packaging. This includes Windows EXE builds and GitHub Actions macOS
  artifacts.
- If a request asks for a same-version/no-bump build and also asks to repackage
  a user-deliverable artifact, treat that as a conflict and stop to report it
  instead of producing another same-version package.
- Version sources must stay synchronized:
  - `VERSION`
  - `internal/version`
  - `frontend/package.json`
  - `frontend/package-lock.json` if needed
  - `frontend/package.json.md5` if Wails expects it
  - tests that assert app version
- `GetAppVersion()` and Settings header must show the bumped version.
- `AI_BRIEF.md` must record old version, new version, EXE path, and SHA-256.
- Do not produce a new EXE or macOS artifact with the same version as the
  previous delivered package unless the round is explicitly docs-only and no
  package is built.
- For alpha/beta builds, increment the prerelease number, e.g. `0.4.0-beta.1` -> `0.4.0-beta.2`.
