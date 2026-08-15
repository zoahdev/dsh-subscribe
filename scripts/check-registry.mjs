#!/usr/bin/env node
/**
 * Registry contract checks used by CI and before every release.
 * Exits non-zero on any structural problem.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const registry = JSON.parse(readFileSync(path.join(ROOT, 'registry.json'), 'utf8'))

const errors = []

if (registry.version !== 2) errors.push(`expected version=2, got ${registry.version}`)
if (!Array.isArray(registry.plugins)) errors.push('plugins is not an array')
if (registry.count !== registry.plugins.length) {
  errors.push(`count (${registry.count}) != plugins.length (${registry.plugins.length})`)
}

const ids = new Set()
const specs = new Set()
const SPEC_RE = /^(github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:#[^ ]*)?|(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*)$/

for (const p of registry.plugins) {
  if (!p.id || typeof p.id !== 'string') errors.push(`entry without id: ${JSON.stringify(p).slice(0, 80)}`)
  else if (ids.has(p.id)) errors.push(`duplicate id: ${p.id}`)
  else ids.add(p.id)

  if (!p.install || !p.install.spec) {
    errors.push(`${p.id ?? '?'}: missing install.spec`)
  } else {
    if (!SPEC_RE.test(p.install.spec)) errors.push(`${p.id}: invalid spec ${p.install.spec}`)
    if (specs.has(p.install.spec)) errors.push(`${p.id}: duplicate spec ${p.install.spec}`)
    else specs.add(p.install.spec)
  }

  if (p.verified === true) {
    if (!p.version) errors.push(`${p.id}: verified entry must declare a version`)
    if (!p.homepage) errors.push(`${p.id}: verified entry must declare a homepage`)
    if (!(p.tags && p.tags.length)) errors.push(`${p.id}: verified entry should declare tags`)
  }

  if (!p.description || typeof p.description !== 'string') errors.push(`${p.id}: missing description`)
  if (!p.category || typeof p.category !== 'string') errors.push(`${p.id}: missing category`)
}

if (errors.length > 0) {
  console.error(`registry check failed (${errors.length}):`)
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}

console.log(`registry OK: ${registry.plugins.length} plugins, ${registry.verifiedCount} verified, unique ids/specs`)
