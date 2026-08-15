#!/usr/bin/env node
/**
 * dsh-subscribe — the Steam-style subscription manager for DeepSeek Harness.
 *
 * One-click subscribe on the web storefront, then a single command syncs your
 * subscriptions into a dsh profile:
 *
 *   node scripts/dsh-subscribe.mjs sync --profile web
 *
 * No runtime dependencies. Requires Node >= 18 and network access to dsh's CLI
 * (pnpm dlx @deepseek-ai/dsh).
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
  if (!existsSync(file)) return { version: 1, profile: 'web', plugins: [] }
  return JSON.parse(readFileSync(file, 'utf8'))
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
  if (plugin.install.target === 'npm') return plugin.install.spec
  return plugin.install.spec // git: github:owner/repo
}

function findPlugin(registry, idOrSpec) {
  const byId = registry.plugins.find((p) => p.id === idOrSpec)
  if (byId !== undefined) return byId
  const bySpec = registry.plugins.find((p) => p.install.spec === idOrSpec)
  if (bySpec !== undefined) return bySpec
  if (idOrSpec.startsWith('github:') || idOrSpec.startsWith('@')) {
    return { id: idOrSpec.replace(/^github:/, '').replace(/\//g, '-'), name: idOrSpec, install: { target: 'git', spec: idOrSpec }, verified: false }
  }
  return undefined
}

const args = parseArgs(process.argv.slice(2))
const command = args._[0] ?? 'help'
const subsFile = path.resolve(args.file ?? 'subscriptions.json')

if (command === 'help' || args.help) {
  console.log(`dsh-subscribe — Steam-style subscription manager for DeepSeek Harness

Usage:
  node scripts/dsh-subscribe.mjs list                 list available plugins
  node scripts/dsh-subscribe.mjs subscribe <id>       add to subscriptions [--file F]
  node scripts/dsh-subscribe.mjs unsubscribe <id>     remove from subscriptions [--file F]
  node scripts/dsh-subscribe.mjs status               show subscribed vs installed [--file F]
  node scripts/dsh-subscribe.mjs sync [--profile P]   install subscriptions into profile P [--file F]
  node scripts/dsh-subscribe.mjs help

Examples:
  node scripts/dsh-subscribe.mjs subscribe dsh-plugin-doctor
  node scripts/dsh-subscribe.mjs sync --profile web
  node scripts/dsh-subscribe.mjs status --file my-subs.json
`)
  process.exit(0)
}

if (command === 'list') {
  const registry = loadRegistry()
  console.log(`${registry.plugins.length} plugins in registry (updated ${registry.updated}):`)
  for (const p of registry.plugins) {
    const badge = p.verified ? '✅' : '○'
    console.log(`  ${badge} ${p.id.padEnd(28)} ${p.name} (${p.author}) — ${p.description.slice(0, 60)}`)
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
  saveSubscriptions(subsFile, subs)
  console.log(`subscriptions saved to ${subsFile}`)
  process.exit(0)
}

if (command === 'status') {
  const subs = loadSubscriptions(subsFile)
  console.log(`profile: ${subs.profile} · subscriptions: ${subs.plugins.length}`)
  for (const p of subs.plugins) {
    console.log(`  ${p.installed ? '✅ installed' : '○ pending'}  ${p.id} → ${p.spec}`)
  }
  process.exit(0)
}

if (command === 'sync') {
  const profile = args.profile ?? 'web'
  const subs = loadSubscriptions(subsFile)
  subs.profile = profile
  if (subs.plugins.length === 0) {
    console.log('no subscriptions yet — subscribe on the web storefront first, or run: node scripts/dsh-subscribe.mjs subscribe <id>')
    process.exit(0)
  }
  let ok = 0
  let failed = 0
  for (const p of subs.plugins) {
    process.stdout.write(`[sync] ${p.id} → ${p.spec} ... `)
    const result = run(['dlx', '@deepseek-ai/dsh', 'plugin', '--profile', profile, 'add', p.spec], ROOT)
    const output = (result.stdout ?? '') + (result.stderr ?? '')
    if (result.status === 0) {
      p.installed = true
      p.lastSync = new Date().toISOString()
      p.lastStatus = 'ok'
      ok += 1
      console.log('OK')
    } else {
      p.installed = false
      p.lastStatus = 'failed'
      failed += 1
      console.log('FAILED')
      if (output.includes('allowBuilds') || output.includes('ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED')) {
        console.log("    ↳ pnpm blocks git installs by default. Add the exact key the dsh CLI prints to the profile's pnpm-workspace.yaml allowBuilds, then re-run sync.")
      } else {
        console.log(`    ↳ ${output.split('\n').filter(Boolean).slice(-3).join('\n    ↳ ')}`)
      }
    }
  }
  saveSubscriptions(subsFile, subs)
  console.log(`\nsync done: ${ok} installed, ${failed} failed → ${subsFile}`)
  process.exit(failed === 0 ? 0 : 1)
}

console.error(`unknown command: ${command} (run 'dsh-subscribe help')`)
process.exit(1)
