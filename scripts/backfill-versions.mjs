#!/usr/bin/env node
/**
 * Backfill `version` for verified entries that lack one.
 *
 * Source of truth: GitHub latest release tag for git specs, npm dist-tag
 * `latest` for npm specs. Only writes entries that are already verified.
 * Network-dependent; run occasionally, not in CI.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REGISTRY_PATH = path.join(ROOT, 'registry.json')

async function latestGitVersion(spec) {
  const repo = spec.replace(/^github:/, '').replace(/#.*$/, '')
  const url = `https://api.github.com/repos/${repo}/releases/latest`
  const res = await fetch(url, { headers: { 'User-Agent': 'dsh-subscribe' } })
  if (!res.ok) return null
  const data = await res.json()
  return typeof data.tag_name === 'string' ? data.tag_name.replace(/^v/i, '') : null
}

async function latestNpmVersion(spec) {
  const encoded = spec.replace('/', '%2F')
  const res = await fetch(`https://registry.npmjs.org/${encoded}/latest`)
  if (!res.ok) return null
  const data = await res.json()
  return typeof data.version === 'string' ? data.version : null
}

async function packageJsonVersion(spec) {
  const repo = spec.replace(/^github:/, '').replace(/#.*$/, '')
  for (const ref of ['HEAD', 'main', 'master']) {
    try {
      const res = await fetch(`https://raw.githubusercontent.com/${repo}/${ref}/package.json`, {
        headers: { 'User-Agent': 'dsh-subscribe' },
      })
      if (!res.ok) continue
      const data = await res.json()
      if (typeof data.version === 'string' && data.version !== '') return data.version
    } catch { /* try next ref */ }
  }
  return null
}

async function main() {
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'))
  let updated = 0
  let failed = 0
  for (const p of registry.plugins) {
    if (!p.verified || p.version) continue
    const spec = p.install?.spec ?? ''
    let version = spec.startsWith('github:') ? await latestGitVersion(spec) : await latestNpmVersion(spec)
    if (!version && spec.startsWith('github:')) version = await packageJsonVersion(spec)
    if (version) {
      p.version = version
      updated += 1
      console.log(`  ${p.id} → ${version}`)
    } else {
      failed += 1
      console.log(`  ${p.id}: no version found`)
    }
  }
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n', 'utf8')
  console.log(`backfill done: ${updated} updated, ${failed} still missing`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
