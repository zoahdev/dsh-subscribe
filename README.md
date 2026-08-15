# dsh-subscribe

English | [中文](#中文)

[![CI](https://github.com/zoahdev/dsh-subscribe/actions/workflows/ci.yml/badge.svg)](https://github.com/zoahdev/dsh-subscribe/actions)
[![Release](https://img.shields.io/github/v/release/zoahdev/dsh-subscribe)](https://github.com/zoahdev/dsh-subscribe/releases)
[![Storefront](https://img.shields.io/website?label=storefront&url=https%3A%2F%2Fzoahdev.github.io%2Fdsh-subscribe%2F)](https://zoahdev.github.io/dsh-subscribe/)
[![awesome-dsh-plugin](https://img.shields.io/badge/awesome--dsh--plugin-listed-brightgreen)](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)

**Steam-style plugin marketplace for DeepSeek Harness.** Browse **554+
community plugins** on the web storefront, subscribe to the ones you want,
then run **one command** to install everything into your dsh profile. A
zero-dependency CLI and an in-harness plugin (search/stats/install commands
from the chat) are included.

- 🏪 Storefront: <https://zoahdev.github.io/dsh-subscribe/>
- 📦 Registry: [registry.json](./registry.json) — 554 plugins, 20 verified by
  zoahdev, refreshed from [awesome-dsh-plugin.com](https://awesome-dsh-plugin.com)
- 🔧 CLI: `node scripts/dsh-subscribe.mjs sync --profile web`
- 🤖 In-harness plugin: `market_search`, `market_stats`,
  `market_install_command`

## Quick start (web)

1. Open the [storefront](https://zoahdev.github.io/dsh-subscribe/), search or
   browse, and click **Subscribe** on every plugin you want.
2. Click **Export** to download `subscriptions.json` (or copy the sync
   command — the page also offers a one-click **copy install command** per
   plugin).
3. Run sync once:

```sh
git clone https://github.com/zoahdev/dsh-subscribe
cd dsh-subscribe
# put the exported subscriptions.json here
node scripts/dsh-subscribe.mjs sync --profile web
```

That's it. Every subscribed plugin is installed into the `web` profile.

## CLI

```sh
node scripts/dsh-subscribe.mjs list [query]            # list/search plugins
node scripts/dsh-subscribe.mjs subscribe <id>          # add a subscription
node scripts/dsh-subscribe.mjs unsubscribe <id>        # remove a subscription
node scripts/dsh-subscribe.mjs status                  # subscribed vs installed
node scripts/dsh-subscribe.mjs export                  # write/normalize subscriptions.json
node scripts/dsh-subscribe.mjs install <id>            # install ONE plugin now
node scripts/dsh-subscribe.mjs sync [--profile web]    # install all subscriptions
node scripts/dsh-subscribe.mjs sync --dry-run          # preview without installing
```

Examples:

```sh
node scripts/dsh-subscribe.mjs subscribe dsh-plugin-doctor
node scripts/dsh-subscribe.mjs install dsh-github-intelligence --profile web
node scripts/dsh-subscribe.mjs sync --profile web
```

The CLI has **zero runtime dependencies** (Node ≥ 18) and drives the real dsh
CLI under the hood: `pnpm dlx @deepseek-ai/dsh plugin --profile <p> add <spec>`.

## In-harness plugin

Install the market **inside DeepSeek Harness** so the agent can find plugins
for you:

```sh
dsh plugin --profile web add github:zoahdev/dsh-subscribe#path:/plugin
```

Restart `dsh web`, then ask your agent to search the market. The plugin
registers three tools:

| Tool | Purpose |
| --- | --- |
| `market_search` | Search 554+ plugins by query/category/verified flag, sorted by stars |
| `market_stats` | Total/verified counts and per-category breakdown |
| `market_install_command` | Returns the exact `dsh plugin add` commands for the user to run |

The plugin ships a bundled registry snapshot, so it keeps working offline.
The plugin also mounts a **full in-harness storefront** at
`http://localhost:<dsh-web-port>/dsh-subscribe/` — browse/search the registry,
then install, uninstall, update, and approve build scripts with one click,
right from the browser. Every button drives the real dsh CLI on your machine;
mutating requests require a same-origin POST and installs are restricted to
curated registry specs (or explicit `file:`/`link:` specs).

HTTP API (same-origin):

| Route | Method | Purpose |
| --- | --- | --- |
| `/dsh-subscribe/registry` | GET | registry + stats |
| `/dsh-subscribe/installed` | GET | installed plugins |
| `/dsh-subscribe/status` | GET | live install progress |
| `/dsh-subscribe/updates` | GET | update availability |
| `/dsh-subscribe/logs` | GET | sanitized plain-text log export |
| `/dsh-subscribe/install` | POST | one-click install (curated or file:/link:) |
| `/dsh-subscribe/uninstall` | POST | one-click uninstall |
| `/dsh-subscribe/update` | POST | one-click update |
| `/dsh-subscribe/approve-builds` | POST | allow build scripts for installed packages |
| `/dsh-subscribe/cancel` | POST | cancel the running operation |
| `/dsh-subscribe/` | GET | in-harness storefront UI |

Build it locally with `cd plugin && pnpm install && pnpm pack`, then
`dsh plugin --profile web add ./dsh-subscribe-0.3.1.tgz`.

## Registry and the "verified" flag

`registry.json` is the source of truth for the storefront, the CLI and the
plugin.

- `verified: true` means **zoahdev audited** the plugin: CI, release/tag,
  install path, and a runtime smoke test were all exercised. That is a real
  but **limited** guarantee — it is not a security audit.
- All other entries are mirrored from
  [awesome-dsh-plugin.com/plugins.json](https://awesome-dsh-plugin.com/plugins.json)
  for discovery (`verified: false`). Check the source before trusting any
  third-party plugin: **listing ≠ endorsement**.

To refresh the community snapshot and rebuild the merged registry:

```sh
curl -sf https://awesome-dsh-plugin.com/plugins.json -o data/registry-snapshot.json
node scripts/build-registry.mjs
node scripts/check-registry.mjs
```

## Troubleshooting

### pnpm blocks git installs (allowBuilds)

`dsh plugin add github:...` can fail with `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`
or `Ignored build scripts`. This is pnpm's default safety gate, not a plugin
bug. Fix:

1. Re-run the command and read the exact package key pnpm prints.
2. Open your profile's `pnpm-workspace.yaml` (inside `~/.dsh/profiles/web/`
   by default) and add the key to `allowBuilds`.
3. Re-run `sync` (or the install command).

The CLI detects this failure mode and prints the same hint automatically.

### The storefront shows an old registry

The page fetches `registry.json` from `raw.githubusercontent.com`, which can
cache for a few minutes after a push. Hard-refresh (Ctrl/Cmd+Shift+R) or wait,
then reload.

### `market_search` returns fewer results than expected

The plugin tries the live registry first and falls back to the bundled
snapshot when offline. If you are offline the snapshot is used, which may be a
few hours behind the storefront. Re-run later or use the web storefront.

### Node version

CLI: Node ≥ 18. Plugin: Node ≥ 20 (uses `AbortSignal.any` for bounded fetches).

## Verification (what CI actually proves)

The CI pipeline is intentionally strict — it does **not** stop at "the plugin
loads":

1. `node scripts/check-registry.mjs` — structural registry contract (unique
   ids/specs, verified entries declare versions, valid install specs).
2. `node --test tests/cli.test.mjs` — CLI end-to-end: subscribe → sync
   `--dry-run`, merged registry >= 500 plugins.
3. `node --test test/plugin.test.mjs` — pure search/stats/command logic plus
   offline fallback.
4. `pnpm pack` + `scripts/runtime-smoke.mjs` — the **packed tarball** is
   installed into a fresh project, the bundle is loaded through the real
   `apply()`/`ctx.tools.register` path, and all three **handlers are executed
   and asserted** (not just imported).
5. `scripts/dsh-smoke.ps1` — installs the packed tarball into a **fresh DSH
   profile**, verifies `dsh-subscribe` appears in `--dump-config`, and boots
   `dsh web` until HTTP 200 (bounded 30s retry, background process cleaned up).

This validates: manifest/package validity, dependency compatibility, bundle
loadability, DSH boot, and **actual tool callability**. This is a community
project — not an official DeepSeek template, and nothing here is
security-audited.

## Comparing with dsh-market

[dsh-market](https://dshmarket.com) is an excellent visual market **inside**
the DSH web UI (browse → one-click install → themes → updates). `dsh-subscribe`
is a complementary take, not a replacement:

| | dsh-subscribe | dsh-market |
| --- | --- | --- |
| Registry size | 554+ (awesome-dsh-plugin mirror + verified curation) | 300+ (awesome-dsh-plugin live) |
| One-click install inside web UI | — (copy command / CLI sync) | ✅ |
| Steam-style subscription workflow | ✅ | — |
| In-chat agent tools (search/stats/commands) | ✅ | — |
| Zero-dependency CLI | ✅ | — |
| Offline registry snapshot | ✅ (plugin) | ✅ (bundled snapshot) |
| Themes/updates UI | — | ✅ |
| Same-origin install guard, build-approval UX | — | ✅ |

Use both: browse and install visually with dsh-market; subscribe, sync and
let your agent find plugins with dsh-subscribe.

## Contributing

- Found a broken entry or a missing plugin? Open a PR against
  [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
  (the snapshot picks it up automatically), or open an issue here.
- Want your plugin marked `verified`? Open an issue with your repo, CI badge,
  release tag, and install path; after a real audit it gets the badge.

## License

MIT — [dsh-subscribe](https://github.com/zoahdev/dsh-subscribe) ·
[storefront](https://zoahdev.github.io/dsh-subscribe/)

---

## 中文

**dsh-subscribe** —— DeepSeek Harness 的 Steam 式插件市场：在网页商店浏览
**554+ 社区插件**、一键订阅，然后**一条命令**把全部订阅装进你的 dsh
profile。自带零依赖 CLI 和 in-harness 插件（对话里直接搜索/统计/生成安装命令）。

### 快速开始（网页）

1. 打开[商店页](https://zoahdev.github.io/dsh-subscribe/)，搜索并点击
   「订阅」；
2. 点「导出清单」下载 `subscriptions.json`（每个插件卡片也有「复制安装命令」）；
3. 跑一次同步：

```sh
git clone https://github.com/zoahdev/dsh-subscribe
cd dsh-subscribe
# 把导出的 subscriptions.json 放在这里
node scripts/dsh-subscribe.mjs sync --profile web
```

### CLI

```sh
node scripts/dsh-subscribe.mjs list [query]      # 列出/搜索插件
node scripts/dsh-subscribe.mjs subscribe <id>    # 添加订阅
node scripts/dsh-subscribe.mjs unsubscribe <id>  # 取消订阅
node scripts/dsh-subscribe.mjs status            # 订阅 vs 已安装
node scripts/dsh-subscribe.mjs install <id>      # 立即安装单个插件
node scripts/dsh-subscribe.mjs sync [--profile web]   # 安装全部订阅
node scripts/dsh-subscribe.mjs sync --dry-run    # 只预览不安装
```

CLI 零运行时依赖（Node ≥ 18），底层调用真实的
`pnpm dlx @deepseek-ai/dsh plugin --profile <p> add <spec>`。

### 装进 Harness

```sh
dsh plugin --profile web add github:zoahdev/dsh-subscribe#path:/plugin
```

重启 `dsh web` 后，agent 可以直接调用 `market_search`（搜索）、
`market_stats`（统计）、`market_install_command`（生成安装命令，需用户确认后
在终端执行）。插件内置注册表快照，离线也能用。

### verified 的含义

`verified: true` = zoahdev 审计过（CI/发布/安装路径/运行时冒烟都实测过）。
这是真实但有限的保证，**不是安全审计**。其余条目来自
[awesome-dsh-plugin.com](https://awesome-dsh-plugin.com)，仅作发现用途；
「列出一项 ≠ 背书」。

### 排障

- **allowBuilds 拦截**：`dsh plugin add github:...` 报
  `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` 时，按 pnpm 打印的包名，在 profile
  的 `pnpm-workspace.yaml` 的 `allowBuilds` 里加一行，再重跑 sync。CLI 会
  自动提示这个修复。
- **商店页数据旧**：raw.githubusercontent 有几分钟缓存，强制刷新即可。
- **插件搜索结果少**：离线时用内置快照，可能比网页版晚几个小时。

### CI 真的验证了什么

不只是「插件能加载」：注册表结构校验 → CLI 端到端（订阅→dry-run 同步）→
插件单元测试 → **打包产物安装到全新工程、真实注册工具、真实执行三个
handler 并断言** → 装进全新 DSH profile、`--dump-config` 验证、`dsh web`
启动到 HTTP 200（30 秒有界重试）。社区项目，非官方模板，无安全审计。

### 和 dsh-market 的关系

互补而非替代：dsh-market 在 Web UI 里做可视化一键安装/主题/更新；
dsh-subscribe 提供 Steam 式订阅同步、零依赖 CLI、对话内 agent 工具和
554+ 全量注册表。两个一起用体验最佳。

## License

MIT
