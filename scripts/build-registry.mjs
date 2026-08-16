#!/usr/bin/env node
/**
 * Build the merged dsh-subscribe registry.
 *
 * Source 1: curated entries (zoahdev-audited, `verified: true`).
 * Source 2: the community snapshot from awesome-dsh-plugin.com/plugins.json
 *           (daily CI refresh), converted into the same schema.
 *
 * Outputs:
 *   registry.json        full merged registry (used by the storefront + CLI)
 *   data/registry.min.json  compact form embedded in the dsh-subscribe plugin
 *
 * Run: node scripts/build-registry.mjs
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SNAPSHOT_PATH = path.join(ROOT, 'data', 'registry-snapshot.json')
const CURATED_PATH = path.join(ROOT, 'registry.json')
const OUTPUT_PATH = path.join(ROOT, 'registry.json')
const MIN_PATH = path.join(ROOT, 'data', 'registry.min.json')
const PLUGIN_MIN_PATH = path.join(ROOT, 'plugin', 'data', 'registry.min.json')

const CATEGORY_MAP = {
  integration: 'workflow',
  experimental: 'dev',
  tools: 'tools',
}

function normalizeCategory(category) {
  return CATEGORY_MAP[category] ?? category
}

/** Parse `dsh plugin --profile web add <spec>` into the bare pnpm spec. */
function specFromInstallLine(line) {
  const trimmed = String(line ?? '').trim()
  const m = /(?:^|\s)add\s+(\S+)\s*$/i.exec(trimmed)
  return m ? m[1] : null
}

/** Build a pnpm git spec from a GitHub URL, honoring /tree/<branch>/<subpath>. */
function specFromUrl(url) {
  const m = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\/tree\/[^/]+\/(.+?))?\/?$/.exec(url)
  if (!m) return null
  const repo = m[1]
  const subpath = m[2]
  return subpath ? `github:${repo}#path:/${subpath}` : `github:${repo}`
}

function curatedEntry(plugin) {
  const description = plugin.description ?? ''
  const verified = plugin.verified === true
  return {
    id: plugin.id,
    name: plugin.name,
    author: plugin.author,
    category: normalizeCategory(plugin.category),
    description,
    description_zh: plugin.description_zh ?? description,
    install: plugin.install,
    version: plugin.version ?? null,
    homepage: plugin.homepage,
    verified,
    tags: plugin.tags ?? [],
    stars: plugin.stars ?? 0,
    source: verified ? { name: 'zoahdev', url: 'https://github.com/zoahdev/dsh-subscribe' } : { name: 'awesome-dsh-plugin', url: 'https://awesome-dsh-plugin.com' },
  }
}

function communityEntry(plugin, index, seenIds) {
  let id = plugin.name
  if (seenIds.has(id)) {
    id = `${plugin.name}--${plugin.owner}`
    let n = 2
    while (seenIds.has(id)) {
      id = `${plugin.name}--${plugin.owner}--${n}`
      n += 1
    }
  }
  seenIds.add(id)

  const fromInstall = specFromInstallLine(plugin.install)
  const fromUrl = specFromUrl(plugin.url)
  const npm = typeof plugin.npm === 'string' && plugin.npm !== '' ? plugin.npm : null
  const spec = npm ?? fromInstall ?? fromUrl
  const target = npm ? 'npm' : 'git'

  const description = plugin.description?.en ?? plugin.description?.zh ?? ''
  const descriptionZh = plugin.description?.zh ?? description

  return {
    id,
    name: plugin.name,
    author: plugin.owner,
    category: plugin.category,
    description,
    description_zh: descriptionZh,
    install: spec ? { target, spec } : null,
    version: null,
    homepage: plugin.url,
    verified: false,
    tags: [plugin.category, 'community'],
    stars: plugin.stars ?? 0,
    source: {
      name: 'awesome-dsh-plugin',
      url: 'https://awesome-dsh-plugin.com',
      page: plugin.page ?? null,
      added: plugin.added ?? null,
    },
  }
}

function main() {
  const previous = JSON.parse(readFileSync(CURATED_PATH, 'utf8'))
  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'))

  // Idempotence: registry.json is BOTH the curated source and the output.
  // Only entries we own (source.name === 'zoahdev') are treated as curated;
  // everything else is re-created from the community snapshot every run.
  const curatedPlugins = previous.plugins.filter(
    (p) => p.verified === true && p.source?.name === 'zoahdev',
  )
  const curated = { plugins: curatedPlugins.length > 0 ? curatedPlugins : previous.plugins }

  const seenIds = new Set()
  const seenSpecs = new Set()
  const plugins = []
  for (const p of curated.plugins) {
    seenIds.add(p.id)
    const ce = curatedEntry(p)
    if (ce.install?.spec) seenSpecs.add(ce.install.spec)
    plugins.push(ce)
  }

  let dropped = 0
  for (const p of snapshot.plugins) {
    // The curated list wins on id collision; keep the verified entry.
    if (seenIds.has(p.name)) {
      dropped += 1
      continue
    }
    const entry = communityEntry(p, 0, seenIds)
    if (entry.install === null) {
      dropped += 1
      continue
    }
    // The curated list (and any earlier entry) also wins on install-spec
    // collision, so a community mirror of an already-listed repo is skipped.
    if (entry.install.spec && seenSpecs.has(entry.install.spec)) {
      dropped += 1
      continue
    }
    if (entry.install.spec) seenSpecs.add(entry.install.spec)
    plugins.push(entry)
  }

  const output = {
    version: 2,
    updated: new Date().toISOString().slice(0, 10),
    count: plugins.length,
    verifiedCount: plugins.filter((p) => p.verified).length,
    note: 'verified=true means zoahdev audited CI/release/install. Community entries are mirrored from awesome-dsh-plugin.com (see source.url) and listed for discovery; verify before trusting.',
    categories: {
      ui: { en: 'UI Enhancements', zh: 'UI 增强' },
      theme: { en: 'Themes & Appearance', zh: '主题与外观' },
      model: { en: 'Models & Providers', zh: '模型与账号接入' },
      session: { en: 'Sessions & Messages', zh: '会话与消息' },
      memory: { en: 'Memory', zh: '记忆' },
      tools: { en: 'Tools & Capabilities', zh: '工具与能力' },
      skill: { en: 'Skills', zh: '技能包' },
      workflow: { en: 'Workflow & Automation', zh: '工作流与自动化' },
      notify: { en: 'Notifications & Integrations', zh: '通知与集成' },
      dev: { en: 'Development & Runtime', zh: '开发与运行时' },
      market: { en: 'Market', zh: '市场' },
      security: { en: 'Security & Safety', zh: '安全与防护' },
      fun: { en: 'Just for Fun', zh: '娱乐' },
    },
    plugins,
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8')

  const min = plugins.map((p) => ({
    id: p.id,
    name: p.name,
    author: p.author,
    category: p.category,
    description: (p.description ?? '').slice(0, 200),
    description_zh: (p.description_zh ?? '').slice(0, 200),
    spec: p.install?.spec ?? null,
    verified: p.verified,
    stars: p.stars ?? 0,
    version: p.version ?? null,
  }))
  mkdirSync(path.dirname(MIN_PATH), { recursive: true })
  writeFileSync(MIN_PATH, JSON.stringify(min), 'utf8')
  mkdirSync(path.dirname(PLUGIN_MIN_PATH), { recursive: true })
  writeFileSync(PLUGIN_MIN_PATH, JSON.stringify(min), 'utf8')

  console.log(`merged registry: ${plugins.length} plugins (${output.verifiedCount} verified), ${dropped} snapshot entries skipped`)
  console.log(`wrote ${path.relative(ROOT, OUTPUT_PATH)}, ${path.relative(ROOT, MIN_PATH)} and ${path.relative(ROOT, PLUGIN_MIN_PATH)}`)
}

main()
