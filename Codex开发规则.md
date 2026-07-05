# ServerPilot Codex 开发规则

英文兼容入口：`AGENTS.md`。

本文件是 Codex / agent 开发规则的中文主文档。`AGENTS.md` 必须继续保留，供 Codex 和其他 agent 工具默认读取；两者冲突时，以本文件的完整中文规则和架构/安全文档为准。

## 文档优先级

1. `架构说明.md` / `ARCHITECTURE.md`
2. `安全边界.md` / `SECURITY.md`
3. `Codex开发规则.md` / `AGENTS.md`
4. `当前轮次状态.md` / `AI_BRIEF.md`
5. `开发进展.md` / `DEV_PROGRESS.md`
6. `项目交接.md` / `HANDOFF.md`
7. `路线图.md` / `ROADMAP.md`

架构和安全规则优先级高于功能路线图。`AI_BRIEF.md` / `当前轮次状态.md` 只描述当前进度，不允许覆盖架构冻结规则。

## 架构冻结 v1.0

ServerPilot 的核心架构已经冻结。未来开发只能把能力挂接到现有结构上，不能重建、替换或合并核心结构。

永久冻结的核心：

- SSH、Monitor、Terminal、SFTP、SCP、Tunnel、Docker、Local Terminal runtime 必须相互隔离。
- Workspace state model 必须与 selected server、terminal session state 分离。
- `DisconnectServer(serverID)` 是服务器级关闭入口。
- `SecretStore` 是 password / passphrase 的敏感信息存储边界。
- Key Vault 可以保存平台保护后的 private key 密文和 metadata，不存明文 private key 或 passphrase。
- SQLite 只能存非敏感数据，以及 Key Vault 受平台保护的 private key 密文这一明确例外。

硬规则：

- 所有 runtime state 和 events 必须按 `serverID` 隔离；terminal events 还必须带 `sessionID`。
- UI 只负责展示和发起用户动作，不得直接控制 SSH worker，不得解析 SSH/SFTP/Linux 输出。
- 新功能必须通过现有 manager、store、typed Wails API、event system 或 UI panel 扩展。
- 不允许合并 Monitor、Terminal、SFTP、SCP、Tunnel、Docker、Local Terminal runtime。
- 不允许重写 SSH client、credential resolver、workspace state machine、`DisconnectServer` 生命周期、`SecretStore` 或 Key Vault 存储模型。
- 不允许把 SFTP 改成右侧栏、抽屉或浮动面板；SFTP 必须保持在终端下方、状态栏上方。

一句话原则：ServerPilot 只能“挂接能力”，不能“重建结构”。

## 项目范围

ServerPilot 是 Wails v2 桌面应用，目标平台包括 Windows x64、macOS Intel x64 和 macOS Apple Silicon。

已实现阶段已经超过最初 MVP，但固定技术栈和核心分层仍然有效。任何新阶段都必须先确认当前架构冻结规则，再做最小范围增量。

## 固定技术栈

- Go backend
- Wails v2
- Vue 3、TypeScript、Vite
- Pinia
- `golang.org/x/crypto/ssh`
- `github.com/pkg/sftp`
- Apache ECharts
- Pure Go SQLite driver；禁止引入 CGO 作为默认依赖
- npm
- Go 标准 `testing` 和前端单元测试

禁止升级到 Wails v3，除非用户明确开启单独迁移阶段。

## 工程要求

- 连接管理、SSH transport、Linux parser、monitor orchestration、persistence、logging、UI 必须保持模块分离。
- Wails 边界必须使用明确 request / response struct。
- 禁止使用 `map[string]interface{}` 作为 application API contract。
- 每个阻塞后端操作必须接受或派生 `context.Context`。
- 每个后台 goroutine 必须有明确 owner、cancel path 和 completion signal。
- Interactive terminal、monitoring、SFTP 必须使用独立 SSH client session，避免互相阻塞。
- 不允许从零实现 SSH、SFTP 或 terminal protocol。
- 不允许在 core code 中硬编码 Windows 路径；使用 `os.UserConfigDir`、`filepath.Join` 和平台 adapter。
- 不允许把 password、passphrase、明文 private-key content 写入 SQLite、JSON、logs、test fixtures 或 source code。
- password / passphrase 敏感存储必须经过 `SecretStore` interface；Key Vault 私钥正文只能经平台保护器加密/保护后作为密文保存。
- 日志只能写结构化字段和 sanitized error；禁止记录 authentication payload。
- 单个 metric 不支持时必须标记 unavailable，不能停止整个 monitoring loop。
- 不允许用空 catch、忽略 error、删除测试或放宽测试来掩盖失败。

## 安全边界

永久禁止：

- SQLite 存 password。
- SQLite 存明文 private key content。
- SQLite 存 private-key passphrase。
- SQLite 存未受平台保护的 private key blob。
- logs 写入 secret。
- frontend state 持久化 secret。
- Wails event 传 secret。
- backup/export 在非完整加密模式下泄露 secret。

Key Vault 规则：

- Key Vault encrypted database 条目可以保存平台保护后的 private key 密文。
- Windows 保护范围使用当前 Windows 用户级保护；密文不保证跨 Windows 用户或跨电脑可解密。
- SQLite 禁止保存明文 private key、private-key passphrase、保护器主密钥、完整原始本地路径或 SecretStore 值。
- 服务器 profile 只保存 `key_vault_id`，同一 keyID 可以被多台服务器复用，不复制多份密钥正文。
- legacy path-only 条目保留兼容和迁移入口，但新 UI 不鼓励继续创建路径引用式密钥。
- Key Vault protected blob 不进入 Wails JSON、frontend state、logs、Toast、standard backup 或 full backup。
- 跨电脑携带私钥材料的加密 Key Vault export/import 必须作为单独安全设计，不得借 full backup 静默实现。
- 不存 passphrase。

SecretStore 规则：

- `SecretStore` 是敏感信息边界。
- 平台实现只能通过后端使用。
- UI 只能看到是否已保存、是否可用、sanitized reason code。
- 不允许把真实 secret 回传给前端。

## Linux 监控规则

- CPU：解析 `/proc/stat`，使用连续采样计算使用率。
- Memory：解析 `/proc/meminfo`，优先使用 `MemAvailable`。
- 默认网卡：解析 `ip route show default`， fallback 到 `/proc/net/route`。
- Network counters：读取选中 interface 的 `rx_bytes` 和 `tx_bytes`。
- Network speed：使用真实 elapsed seconds，并以 bytes per second 展示。
- Disk：解析 `df -P -B1 /`，不得依赖本地化表头。
- Load：解析 `/proc/loadavg`。
- Uptime：解析 `/proc/uptime`。
- System identity：解析 `/etc/os-release` 和 `uname`。
- 可以合并为单个带标记的 remote script，但 parser 必须保持可测试。

## 表单控件尺寸规则

1. 禁止无条件对所有 `input` / `select` 使用 `width: 100%`。
2. 数字输入框必须根据允许范围和单位确定宽度。
3. 百分比输入通常为 80-96px。
4. 秒数、端口等短数字输入通常为 80-110px。
5. 普通下拉框按最长选项确定合理宽度。
6. 搜索框可以弹性伸缩，但必须设置合理的 `min-width` / `max-width`。
7. 路径、命令、备注等长文本输入才可以占用主要剩余宽度。
8. 单位必须放在输入框外，不使用 placeholder 充当单位。
9. 同一表单中的 label、input、select、checkbox 必须使用明确 grid/flex 对齐。
10. 新增 UI 必须在默认窗口和缩小窗口下检查控件尺寸。
11. 字段宽度必须按内容长度和产品布局设计，不允许所有字段统一无限拉伸。
12. 同类字段必须共享明确尺寸 token；表单整体宽度变化时必须同步调整 modal 宽度。
13. 所有普通单选下拉框必须使用统一 chevron icon、统一右侧内边距和统一垂直居中规则。
14. 禁止使用字体字符、浏览器原生三角或每个页面独立重复实现下拉箭头。
15. 新增下拉框不得覆盖全局 chevron 的 `background-image` / `background-position` / `padding-right`，除非同步更新全局规则和测试。
16. UI 完成不能只依赖 DOM 测试；必须检查真实渲染尺寸、CSS token 或截图/浏览器级验证。
17. 文档写“已修复”前必须以实际界面截图、可渲染测试或 CSS/组件尺寸契约确认。

## 验证要求

每个有意义的开发阶段按风险运行：

```text
gofmt
go vet ./...
go test ./...
npm run type-check
npm run test
npm run build
wails build
```

文档-only 阶段至少运行：

```text
git diff --check
```

失败必须修根因。不允许删除测试、不允许放宽测试、不允许绕过类型检查。

## Build 后快速收尾流程

完成代码修改和必要验证后，使用以下标准流程收尾：

1. 完成代码修改。
2. 按变更风险运行 `gofmt` / `go vet ./...` / `go test ./...` / `npm run type-check` / `npm run test` / `npm run build` / `wails build`。
3. 确认全部通过。
4. 计算 EXE SHA-256 一次。
5. 只编辑本轮需要的中文主文档。
6. 运行 `scripts/finalize-after-build.ps1` 同步英文兼容文档。
7. 运行脚本 `-Check` 和 `git diff --check`。
8. 创建提交。
9. 最终回复用户。

文档同步级别：

- Current：普通 bugfix / UI 调整 / 小功能，只更新 `当前轮次状态.md`、`AI_BRIEF.md`、`开发进展.md`、`DEV_PROGRESS.md`。
- Milestone：完整功能阶段完成，额外更新 `项目交接.md`、`HANDOFF.md`、`路线图.md`、`ROADMAP.md`。
- Rules：只有架构、安全或 agent 开发规则变化时，才更新 `架构说明.md`、`ARCHITECTURE.md`、`安全边界.md`、`SECURITY.md`、`Codex开发规则.md`、`AGENTS.md`。

硬约束：

- 中文主文档是单一事实源，英文兼容入口由 `finalize-after-build.ps1` 生成。
- `AI_BRIEF.md` 必须保持 120 行以内，并与 `当前轮次状态.md` 同步。
- 文档同步完成后，如果之后只有 Markdown 文件发生变化，不得再次运行完整 Go / npm / Wails build 验证。
- 只有文档同步脚本、生成绑定或源代码又发生变化时，才重新验证相应内容。
- 不得为了最终回复再次扫描整个仓库。
- 最终回复直接使用已经取得的测试结果、EXE 路径和 SHA。
- 不得重复计算 SHA 多次。
- 不得每轮重写 `HANDOFF.md` / `ROADMAP.md` / `ARCHITECTURE.md` / `SECURITY.md`。

## Git 与交付

- 每轮创建聚焦提交。
- 不提交 runtime database、logs、credentials、private keys。
- 不随意提交 generated bindings 或 build output，除非该阶段确实需要。
- 文档更新必须写清楚用户可见变化、未改动的 runtime / lifecycle / security 边界，以及验证结果。
