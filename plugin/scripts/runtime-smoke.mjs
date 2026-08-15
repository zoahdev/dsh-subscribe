#!/usr/bin/env node
/**
 * Packaged runtime smoke test: proves the packed plugin artifact actually
 * loads, registers its tools, and that every handler executes and returns
 * the expected shape. Runs against the pnpm-packed tarball in a fresh
 * project, exactly as a user would install it.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tgz = path.resolve(process.argv[2] ?? path.join(root, 'dsh-subscribe-0.2.0.tgz'))

if (!existsSync(tgz)) {
  console.error(`[runtime-smoke] missing tarball: ${tgz}`)
  process.exit(1)
}

function runPnpm(args, cwd) {
  if (process.platform === 'win32') {
    return spawnSync(`pnpm ${args.join(' ')}`, { cwd, stdio: 'inherit', shell: true })
  }
  return spawnSync('pnpm', args, { cwd, stdio: 'inherit' })
}

const dir = mkdtempSync(path.join(tmpdir(), 'dsh-subscribe-smoke-'))
try {
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'dsh-subscribe-smoke-host',
        private: true,
        version: '1.0.0',
        dependencies: {
          '@deepseek-ai/cordis': '^4.0.1',
          '@deepseek-ai/dsh-tools': '0.1.0-rc.6',
          'dsh-subscribe': `file:${tgz.replaceAll('\\', '/')}`,
        },
      },
      null,
      2,
    ),
  )

  console.log('[runtime-smoke] installing packed tarball into a fresh project…')
  const install = runPnpm(['install'], dir)
  if (install.status !== 0) {
    console.error('[runtime-smoke] pnpm install failed')
    process.exit(1)
  }

  const pluginIndex = path.join(dir, 'node_modules', 'dsh-subscribe', 'lib', 'index.js')
  if (!existsSync(pluginIndex)) {
    throw new Error('packed plugin entry lib/index.js missing after install')
  }

  console.log('[runtime-smoke] loading the packed plugin bundle…')
  const plugin = await import(pathToFileURL(pluginIndex).href)
  if (plugin.name !== 'dsh-subscribe') {
    throw new Error(`unexpected plugin name: ${plugin.name}`)
  }

  const registered = []
  const ctx = {
    tools: {
      register: (definition) => {
        registered.push(definition)
        return () => {}
      },
    },
  }

  // Force the offline path for the whole scenario so the smoke test never
  // depends on network or on the live registry having been pushed yet.
  globalThis.fetch = async () => { throw new Error('offline (runtime smoke)') }
  plugin.apply(ctx)

  const names = registered.map((t) => t.name).sort()
  const expected = ['market_install_command', 'market_search', 'market_stats']
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`registered tools mismatch: ${names.join(', ')}`)
  }
  console.log(`[runtime-smoke] tools registered: ${names.join(', ')}`)

  const exec = { signal: new AbortController().signal }

  const search = registered.find((t) => t.name === 'market_search')
  const searchResult = await search.execute({ query: 'doctor', limit: 5 }, exec)
  if (!Number.isInteger(searchResult.total) || searchResult.total < 1) {
    throw new Error(`market_search returned no results: ${JSON.stringify(searchResult)}`)
  }
  if (!Array.isArray(searchResult.plugins) || searchResult.plugins.length === 0) {
    throw new Error('market_search returned an empty plugins array')
  }
  const rendered = search.output.render({ query: 'doctor' }, searchResult).map((b) => b.text ?? '').join('\n')
  if (!rendered.includes(searchResult.plugins[0].name)) {
    throw new Error('market_search render output is missing plugin names')
  }
  console.log(`[runtime-smoke] market_search executed: ${searchResult.total} matches, render asserted`)

  const stats = registered.find((t) => t.name === 'market_stats')
  const statsResult = await stats.execute({}, exec)
  if (!Number.isInteger(statsResult.total) || statsResult.total < 500) {
    throw new Error(`market_stats total too small: ${JSON.stringify(statsResult)}`)
  }
  if (typeof statsResult.byCategory !== 'object' || Object.keys(statsResult.byCategory).length < 5) {
    throw new Error('market_stats byCategory is missing categories')
  }
  console.log(`[runtime-smoke] market_stats executed: ${statsResult.total} plugins, ${Object.keys(statsResult.byCategory).length} categories`)

  const commands = registered.find((t) => t.name === 'market_install_command')
  const commandResult = await commands.execute({ ids: 'dsh-plugin-doctor,dsh-context', profile: 'web' }, exec)
  if (commandResult.count !== 2 || commandResult.commands.length !== 2) {
    throw new Error(`market_install_command wrong count: ${JSON.stringify(commandResult)}`)
  }
  if (!commandResult.commands[0].startsWith('dsh plugin --profile web add ')) {
    throw new Error(`unexpected command shape: ${commandResult.commands[0]}`)
  }
  console.log(`[runtime-smoke] market_install_command executed: ${commandResult.count} commands`)

  console.log('PASS [runtime-smoke] packed plugin loaded, tools registered, all handlers executed and asserted')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
