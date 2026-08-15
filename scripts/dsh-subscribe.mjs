#!/usr/bin/env node
/**
 * dsh-subscribe — the Steam-style subscription manager for DeepSeek Harness.
 *
 * Subscribe on the web storefront (or here in the terminal), then run one
 * command to sync everything into a dsh profile:
 *
 *   node scripts/dsh-subscribe.mjs sync --profile web
 *
 * No runtime dependencies. Requires Node >= 18 and network access to dsh's
 * CLI (pnpm dlx @deepseek-ai/dsh).
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REGISTRY_PATH = path.join(ROOT, 'registry.json')

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        args[key] = next
        i += 1
      } else {
        args[key] = true
      }
    } else {
      args._.push(arg)
    }
  }
  return args
}

function loadRegistry() {
  return JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'))
}

function loadSubscriptions(file) {
  if (!existsSync(file)) return { version: 2, profile: 'web', plugins: [] }
  const data = JSON.parse(readFileSync(file, 'utf8'))
  return Array.isArray(data)
    ? { version: 2, profile: 'web', plugins: data.map((x) => ({ id: String(x.id ?? x), addedAt: x.addedAt })) }
    : data
}

function saveSubscriptions(file, subs) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(subs, null, 2) + '\n', 'utf8')
}

function run(args, cwd) {
  const command = process.platform === 'win32' ? `pnpm ${args.join(' ')}` : 'pnpm'
  return spawnSync(command, process.platform === 'win32' ? [] : args, {
    cwd,
    stdio: 'pipe',
    shell: process.platform === 'win32',
    encoding: 'utf8',
    timeout: 180_000,
  })
}

function specOf(plugin) {
  return plugin.install?.spec ?? plugin.id
}

function findPlugin(registry, idOrSpec) {
  const byId = registry.plugins.find((p) => p.id === idOrSpec)
  if (byId !== undefined) return byId
  const bySpec = registry.plugins.find((p) => p.install?.spec === idOrSpec)
  if (bySpec !== undefined) return bySpec
  const bare = idOrSpec.replace(/^github:/, '').replace(/#.*$/, '')
  const byRepo = registry.plugins.find((p) => {
    const s = p.install?.spec ?? ''
    return s.replace(/^github:/, '').replace(/#.*$/, '').toLowerCase() === bare.toLowerCase()
  })
  if (byRepo !== undefined) return byRepo
  if (idOrSpec.startsWith('github:') || idOrSpec.startsWith('@') || /^[a-z0-9-]+$/.test(idOrSpec)) {
    console.warn(`  note: "${idOrSpec}" is not in the registry — treating it as a raw install spec`)
    return {
      id: bare.replace(/\//g, '-'),
      name: idOrSpec,
      install: { target: idOrSpec.startsWith('@') ? 'npm' : 'git', spec: idOrSpec },
      verified: false,
      description: idOrSpec,
    }
  }
  return undefined
}

function dedupe(list) {
  const seen = new Set()
  return list.filter((p) => {
    const key = `${p.id}\u0000${p.spec ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function allowBuildsHint(output) {
  if (output.includes('ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED') || output.includes('allowBuilds')) {
    const names = [...output.matchAll(/Ignored build scripts:\s*([^\n]+)/gi)]
      .flatMap((m) => m[1].split(','))
      .map((s) => s.trim().replace(/\.$/, '').replace(/@\d+.*$/, ''))
      .filter(Boolean)
    return `pnpm blocks git installs by default. Add the exact key the dsh CLI prints to the profile's pnpm-workspace.yaml allowBuilds${names.length ? ` (e.g. ${names.slice(0, 4).join(', ')})` : ''}, then re-run sync.`
  }
  return null
}

function printList(registry, query) {
  const q = (query ?? '').trim().toLowerCase()
  const list = q
    ? registry.plugins.filter((p) => `${p.name} ${p.id} ${p.author} ${p.description} ${p.description_zh ?? ''}`.toLowerCase().includes(q))
    : registry.plugins
  if (q) console.log(`${list.length} matches for "${q}" of ${registry.plugins.length} plugins (updated ${registry.updated}):`)
  else console.log(`${registry.plugins.length} plugins in registry (updated ${registry.updated}, ${registry.verifiedCount} verified):`)
  for (const p of list) {
    const badge = p.verified ? '✓' : '·'
    console.log(`  ${badge} ${p.id.padEnd(30)} ${p.name} (${p.author}) — ${(p.description ?? '').slice(0, 60)}`)
  }
}

const args = parseArgs(process.argv.slice(2))
const command = args._[0] ?? 'help'
const subsFile = path.resolve(args.file ?? 'subscriptions.json')
const json = args.json === true

if (command === 'help' || args.help) {
  console.log(`dsh-subscribe — Steam-style subscription manager for DeepSeek Harness

Usage:
  node scripts/dsh-subscribe.mjs list [query]            list/search plugins [--json]
  node scripts/dsh-subscribe.mjs search <query>          alias of list with query
  node scripts/dsh-subscribe.mjs subscribe <id>          add to subscriptions [--file F]
  node scripts/dsh-subscribe.mjs unsubscribe <id>        remove from subscriptions [--file F]
  node scripts/dsh-subscribe.mjs status                  subscribed vs installed [--file F] [--json]
  node scripts/dsh-subscribe.mjs export [--file F]       write/normalize subscriptions file
  node scripts/dsh-subscribe.mjs install <id>            install ONE plugin now [--profile P] [--dry-run]
  node scripts/dsh-subscribe.mjs sync [--profile P]      install all subscriptions [--file F] [--dry-run]
  node scripts/dsh-subscribe.mjs version

Examples:
  node scripts/dsh-subscribe.mjs subscribe dsh-plugin-doctor
  node scripts/dsh-subscribe.mjs install dsh-github-intelligence --profile web
  node scripts/dsh-subscribe.mjs sync --profile web
  node scripts/dsh-subscribe.mjs sync --dry-run --file my-subs.json
`)
  process.exit(0)
}

if (command === 'version') {
  let version = '0.2.0'
  try {
    version = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version ?? version
  } catch { /* keep default */ }
  console.log(`dsh-subscribe ${version} (registry ${loadRegistry().plugins.length} plugins)`)
  process.exit(0)
}

if (command === 'list' || command === 'search') {
  const registry = loadRegistry()
  const query = command === 'search' ? (args._[1] ?? '') : (args._[1] ?? '')
  if (json) {
    const list = query
      ? registry.plugins.filter((p) => `${p.name} ${p.id} ${p.author}`.toLowerCase().includes(query.toLowerCase()))
      : registry.plugins
    console.log(JSON.stringify({ count: list.length, total: registry.plugins.length, updated: registry.updated, plugins: list }, null, 2))
  } else {
    printList(registry, query)
  }
  process.exit(0)
}

if (command === 'subscribe' || command === 'unsubscribe') {
  const id = args._[1]
  if (id === undefined) {
    console.error(`usage: dsh-subscribe ${command} <id>`)
    process.exit(1)
  }
  const registry = loadRegistry()
  const plugin = findPlugin(registry, id)
  if (plugin === undefined) {
    console.error(`unknown plugin id: ${id} (run 'dsh-subscribe list' to see available)`)
    process.exit(1)
  }
  const subs = loadSubscriptions(subsFile)
  subs.profile = args.profile ?? subs.profile ?? 'web'
  const idx = subs.plugins.findIndex((p) => p.id === plugin.id)
  if (command === 'subscribe') {
    if (idx === -1) {
      subs.plugins.push({ id: plugin.id, name: plugin.name, spec: specOf(plugin), addedAt: new Date().toISOString(), installed: false })
      console.log(`subscribed: ${plugin.id} → ${specOf(plugin)}`)
    } else {
      console.log(`already subscribed: ${plugin.id}`)
    }
  } else {
    if (idx !== -1) {
      subs.plugins.splice(idx, 1)
      console.log(`unsubscribed: ${plugin.id}`)
    } else {
      console.log(`not subscribed: ${plugin.id}`)
    }
  }
  subs.plugins = dedupe(subs.plugins)
  saveSubscriptions(subsFile, subs)
  console.log(`subscriptions saved to ${subsFile}`)
  process.exit(0)
}

if (command === 'status') {
  const subs = loadSubscriptions(subsFile)
  if (json) {
    console.log(JSON.stringify({ profile: subs.profile, count: subs.plugins.length, plugins: subs.plugins }, null, 2))
    process.exit(0)
  }
  console.log(`profile: ${subs.profile} · subscriptions: ${subs.plugins.length}`)
  for (const p of subs.plugins) {
    console.log(`  ${p.installed ? '✓ installed' : '· pending'}  ${p.id} → ${p.spec}`)
  }
  process.exit(0)
}

if (command === 'export') {
  const subs = loadSubscriptions(subsFile)
  subs.plugins = dedupe(subs.plugins)
  saveSubscriptions(subsFile, subs)
  console.log(`subscriptions exported to ${subsFile} (${subs.plugins.length} plugins)`)
  process.exit(0)
}

function installOne(profile, spec, dryRun) {
  const cmd = ['dlx', '@deepseek-ai/dsh', 'plugin', '--profile', profile, 'add', spec]
  if (dryRun) {
    console.log(`[dry-run] pnpm ${cmd.join(' ')}`)
    return { ok: true, dryRun: true }
  }
  process.stdout.write(`[install] ${spec} ... `)
  const result = run(cmd, ROOT)
  const output = (result.stdout ?? '') + (result.stderr ?? '')
  if (result.status === 0) {
    console.log('OK')
    return { ok: true }
  }
  console.log('FAILED')
  const hint = allowBuildsHint(output)
  if (hint) console.log(`  → ${hint}`)
  else console.log(`  → ${output.split('\n').filter(Boolean).slice(-3).join('\n  → ')}`)
  return { ok: false, output }
}

if (command === 'install') {
  const id = args._[1]
  if (id === undefined) {
    console.error('usage: dsh-subscribe install <id> [--profile P] [--dry-run]')
    process.exit(1)
  }
  const profile = args.profile ?? 'web'
  const plugin = findPlugin(loadRegistry(), id)
  if (plugin === undefined) {
    console.error(`unknown plugin id: ${id} (run 'dsh-subscribe list' to see available)`)
    process.exit(1)
  }
  const result = installOne(profile, specOf(plugin), args['dry-run'] === true)
  process.exit(result.ok ? 0 : 1)
}

if (command === 'sync') {
  const profile = args.profile ?? 'web'
  const dryRun = args['dry-run'] === true
  const subs = loadSubscriptions(subsFile)
  subs.profile = profile
  subs.plugins = dedupe(subs.plugins)
  if (subs.plugins.length === 0) {
    console.log('no subscriptions yet — subscribe on the web storefront first, or run: node scripts/dsh-subscribe.mjs subscribe <id>')
    process.exit(0)
  }
  let ok = 0
  let failed = 0
  for (const p of subs.plugins) {
    if (!p.spec) {
      const plugin = findPlugin(loadRegistry(), p.id)
      if (!plugin) {
        failed += 1
        console.log(`[sync] ${p.id}: unknown plugin, skipping`)
        continue
      }
      p.spec = specOf(plugin)
    }
    const result = installOne(profile, p.spec, dryRun)
    if (result.ok) {
      if (!dryRun) {
        p.installed = true
        p.lastSync = new Date().toISOString()
        p.lastStatus = 'ok'
      }
      ok += 1
    } else {
      p.installed = false
      p.lastStatus = 'failed'
      failed += 1
    }
  }
  if (!dryRun) saveSubscriptions(subsFile, subs)
  console.log(`\nsync done: ${ok} installed, ${failed} failed → ${subsFile}`)
  process.exit(failed === 0 ? 0 : 1)
}

console.error(`unknown command: ${command} (run 'dsh-subscribe help')`)
process.exit(1)
