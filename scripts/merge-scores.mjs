#!/usr/bin/env node
/**
 * merge-scores.mjs — merge dsh-quality-score results into the registry.
 * Usage: node scripts/merge-scores.mjs <scores.json>
 * Attaches `quality: { score, grade }` to npm-installable registry entries.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scoresPath = path.resolve(process.argv[2] ?? '')
if (!scoresPath) { console.error('usage: node scripts/merge-scores.mjs <scores.json>'); process.exit(2) }
const scores = JSON.parse(readFileSync(scoresPath, 'utf8'))
const byName = new Map(scores.filter((s) => s.error === '' || s.error === undefined).map((s) => [s.name, s]))

for (const file of ['registry.json', 'data/registry.min.json', 'plugin/data/registry.min.json']) {
  const p = path.join(ROOT, file)
  const data = JSON.parse(readFileSync(p, 'utf8'))
  const list = Array.isArray(data) ? data : data.plugins
  let changed = 0
  for (const entry of list) {
    const spec = entry.install?.target === 'npm' ? entry.install.spec : (entry.spec ?? null)
    if (!spec) continue
    const q = byName.get(spec)
    if (q) {
      entry.quality = { score: q.score, grade: q.grade }
      changed++
    }
  }
  writeFileSync(p, JSON.stringify(data, null, file === 'registry.json' ? 2 : 0) + '\n', 'utf8')
  console.log(`${file}: updated ${changed} entries`)
}