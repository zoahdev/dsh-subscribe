# dsh-subscribe

[English](#english) · [中文](#中文)

## English

A **Steam-style plugin marketplace for DeepSeek Harness**: browse the storefront, click **Subscribe** on everything you want, then run **one command** to sync them all into your dsh profile.

- 🛒 Storefront: https://zoahdev.github.io/dsh-subscribe/ (subscribe buttons, search, categories)
- 📦 Registry: [registry.json](./registry.json) — curated, `verified` flag = audited (CI/release/install)
- 🔄 Sync CLI: `node scripts/dsh-subscribe.mjs sync --profile web`

### How it works

1. Open the storefront, click **订阅/Subscribe** on plugins (stored locally in your browser).
2. **Export subscriptions** (`subscriptions.json`) and copy the sync command.
3. Run the sync once — every subscribed plugin is installed into your profile:

```sh
git clone https://github.com/zoahdev/dsh-subscribe
cd dsh-subscribe
# put subscriptions.json here, then:
node scripts/dsh-subscribe.mjs sync --profile web
```

### CLI

```sh
node scripts/dsh-subscribe.mjs list                  # available plugins
node scripts/dsh-subscribe.mjs subscribe <id>        # subscribe from CLI too
node scripts/dsh-subscribe.mjs unsubscribe <id>
node scripts/dsh-subscribe.mjs status                # subscribed vs installed
node scripts/dsh-subscribe.mjs sync --profile web    # install all subscriptions
```

If a git install is blocked by pnpm's `allowBuilds`, the CLI prints the exact fix (add the key the dsh CLI shows to the profile's `pnpm-workspace.yaml`) and you re-run sync.

### Registry

`registry.json` is the source of truth. `verified: true` means zoahdev audited the repo (CI, release, install path). Community entries are listed from public repos with `verified: false` — check before trusting.

## 中文

**dsh-subscribe** —— DeepSeek Harness 的 Steam 式插件市场：网页端浏览 + 一键**订阅**，然后**一条命令**把订阅全部装进你的 dsh profile。

- 🛒 商店页：https://zoahdev.github.io/dsh-subscribe/
- 📦 注册表：[registry.json](./registry.json)（`verified` 标记 = 已审计 CI/Release/安装）
- 🔄 同步：`node scripts/dsh-subscribe.mjs sync --profile web`

### 流程

1. 打开商店页，点"订阅"（存在浏览器本地）；
2. 导出 `subscriptions.json`，复制同步命令；
3. 跑一次 sync，所有订阅装进 profile。

```sh
git clone https://github.com/zoahdev/dsh-subscribe
cd dsh-subscribe
node scripts/dsh-subscribe.mjs sync --profile web
```

git 安装被 pnpm 拦截时，CLI 会打印 allowBuilds 修复指引，改完重跑 sync 即可。

## License

MIT
