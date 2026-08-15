# dsh-subscribe (plugin)

Agent-native plugin marketplace for DeepSeek Harness: search **500+ community
plugins**, read market stats, and get exact install commands — right from the
chat. This is the in-harness companion to the
[web storefront](https://zoahdev.github.io/dsh-subscribe/) and the
[zero-dependency CLI](https://github.com/zoahdev/dsh-subscribe).

## Install

```sh
dsh plugin --profile web add github:zoahdev/dsh-subscribe#path:/plugin
```

Or from a local build:

```sh
cd plugin
pnpm install
pnpm pack
dsh plugin --profile web add ./dsh-subscribe-0.2.0.tgz
```

Restart `dsh web` (or the profile serving your UI). The three tools then
appear in the agent's tool registry:

| Tool | What it does |
| --- | --- |
| `market_search` | Search plugins by query/category/verified flag, sorted by stars |
| `market_stats` | Total plugins, verified count, per-category breakdown |
| `market_install_command` | Returns the exact `dsh plugin --profile <p> add <spec>` commands to run |

`market_install_command` never installs anything by itself — commands are
returned for the user to review and run in a terminal.

## Offline behavior

The plugin ships a bundled snapshot of the full registry. If the live
registry cannot be fetched, all tools automatically fall back to the
snapshot, so search/stats/commands keep working without network access.

## 中文

把插件市场装进 DeepSeek Harness：在对话里直接搜索 **500+ 社区插件**、查看
市场统计、拿到准确的安装命令。与网页商店和零依赖 CLI 配套使用。

```sh
dsh plugin --profile web add github:zoahdev/dsh-subscribe#path:/plugin
```

三个工具：`market_search`（搜索）、`market_stats`（统计）、
`market_install_command`（生成安装命令，需用户确认后在终端执行）。
离线时自动使用内置注册表快照。

## License

MIT
