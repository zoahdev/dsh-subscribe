/**
 * dsh-subscribe — agent-native plugin marketplace for DeepSeek Harness.
 *
 * Registers three tools on the host's tool registry:
 *   - market_search:          search 500+ community plugins
 *   - market_stats:           category/count overview
 *   - market_install_command: build the exact `dsh plugin add` commands
 *
 * The registry is fetched from the live dsh-subscribe storefront with a
 * bundled offline snapshot as fallback, so the tools keep working when the
 * host has no network access.
 */

import { readFileSync } from 'node:fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { mountMarketRoutes } from './market-server.js'

export const name = 'dsh-subscribe'

/** Services required by this plugin. */
export const inject = ['tools']

export const REGISTRY_URL = 'https://raw.githubusercontent.com/zoahdev/dsh-subscribe/main/registry.json'

/** The profile this host process actually booted, if the CLI passed it. */
function argvProfile() {
  const argv = process.argv
  const flag = argv.indexOf('--profile')
  if (flag !== -1 && flag + 1 < argv.length && !argv[flag + 1].startsWith('-')) return argv[flag + 1]
  return undefined
}

/** Load the compact snapshot bundled inside the installed package. */
export function loadEmbeddedRegistry() {
  const raw = readFileSync(new URL('../data/registry.min.json', import.meta.url), 'utf8')
  const plugins = JSON.parse(raw)
  return {
    version: 2,
    updated: 'embedded',
    count: plugins.length,
    verifiedCount: plugins.filter((p) => p.verified).length,
    categories: {},
    plugins,
  }
}

/**
 * Live registry with offline fallback. Never throws: a failed or slow
 * network request degrades to the bundled snapshot.
 */
export async function loadRegistry(signal) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 5000)
  try {
    const combined = AbortSignal.any
      ? AbortSignal.any([signal ?? ac.signal, ac.signal])
      : ac.signal
    const res = await fetch(REGISTRY_URL, { signal: combined, headers: { 'User-Agent': 'dsh-subscribe' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    if (Array.isArray(data.plugins) && data.plugins.length > 0) return data
    throw new Error('empty registry payload')
  } catch {
    return loadEmbeddedRegistry()
  } finally {
    clearTimeout(timer)
  }
}

/** Pure search over a registry object. */
export function searchPlugins(registry, { query = '', category, verifiedOnly = false, limit = 10 }) {
  const q = String(query ?? '').trim().toLowerCase()
  const max = Math.max(1, Math.min(Number.isFinite(limit) ? limit : 10, 100))
  const list = registry.plugins.filter((p) => {
    if (category && p.category !== category) return false
    if (verifiedOnly && !p.verified) return false
    if (q === '') return true
    const hay = `${p.name} ${p.id} ${p.author} ${p.description ?? ''} ${p.description_zh ?? ''} ${(p.tags ?? []).join(' ')}`.toLowerCase()
    return hay.includes(q)
  })
  list.sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0) || a.name.localeCompare(b.name))
  return { total: list.length, plugins: list.slice(0, max) }
}

/** Pure stats over a registry object. */
export function registryStats(registry) {
  const byCategory = {}
  for (const p of registry.plugins) {
    byCategory[p.category] = (byCategory[p.category] ?? 0) + 1
  }
  return {
    total: registry.plugins.length,
    verified: registry.plugins.filter((p) => p.verified).length,
    byCategory,
    updated: registry.updated ?? 'embedded',
  }
}

/** Build the exact `dsh plugin add` commands for ids or a search. */
export function installCommands(registry, { ids = '', query = '', category, profile = 'web', limit = 10 }) {
  const profileSafe = /^[A-Za-z0-9_-]+$/.test(profile) ? profile : 'web'
  const commands = []
  const idList = String(ids ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (idList.length > 0) {
    for (const raw of idList) {
      const p = registry.plugins.find((x) => x.id === raw)
      commands.push(`dsh plugin --profile ${profileSafe} add ${p?.spec ?? raw}`)
    }
  } else {
    const found = searchPlugins(registry, { query, category, limit })
    for (const p of found.plugins) commands.push(`dsh plugin --profile ${profileSafe} add ${p.spec}`)
  }
  return {
    profile: profileSafe,
    count: commands.length,
    commands,
    note: 'Review the commands with the user, then run them in a terminal. git installs may require an allowBuilds entry in the profile\'s pnpm-workspace.yaml; re-run after adding it.',
  }
}

function createTools() {
  return [
    defineTool({
      name: 'market_search',
      description:
        'Search the dsh-subscribe plugin marketplace for DeepSeek Harness (500+ community plugins). '
        + 'Returns id, author, category, stars, verified flag, and bilingual descriptions. '
        + 'Use market_install_command to get the exact install command for a result.',
      parameters: {
        query: { type: 'string', description: 'Free-text search across name, id, author, tags and descriptions' },
        category: { type: 'string', description: 'One of: ui, theme, model, session, memory, tools, skill, workflow, notify, dev, market, fun' },
        verifiedOnly: { type: 'boolean', description: 'Only return plugins verified by zoahdev (audited CI/release/install)' },
        limit: { type: 'integer', description: 'Max results, 1-100 (default 10)' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            total: { type: 'integer', required: true },
            plugins: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
          },
        },
        render: (args, value) => [{
          type: 'text',
          text: `${value.total} matching plugins.\n` + value.plugins.map((p) =>
            `- ${p.name} (id: ${p.id}, category: ${p.category}, stars: ${p.stars ?? 0}, ${p.verified ? 'verified' : 'community'}): ${p.description ?? ''}`,
          ).join('\n'),
        }],
      },
      async execute(args, exec) {
        const registry = await loadRegistry(exec?.signal)
        return searchPlugins(registry, {
          query: args.query ?? '',
          category: args.category,
          verifiedOnly: args.verifiedOnly === true,
          limit: typeof args.limit === 'number' ? args.limit : 10,
        })
      },
      presentCall: (args) => ({ card: 'generic', title: `Market search: ${args.query ?? 'all'}`, kind: 'other', rawInput: args }),
    }),

    defineTool({
      name: 'market_stats',
      description: 'Overview of the dsh-subscribe plugin marketplace: total plugins, verified count, and per-category counts.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            total: { type: 'integer', required: true },
            verified: { type: 'integer', required: true },
            updated: { type: 'string', required: true },
            byCategory: { type: 'object', required: true, additionalProperties: true },
          },
        },
        render: (args, value) => [{
          type: 'text',
          text: `${value.total} plugins (${value.verified} verified, registry updated ${value.updated}): `
            + Object.entries(value.byCategory).map(([cat, n]) => `${cat}=${n}`).join(', '),
        }],
      },
      async execute(args, exec) {
        const registry = await loadRegistry(exec?.signal)
        return registryStats(registry)
      },
      presentCall: () => ({ card: 'generic', title: 'Market stats', kind: 'other', rawInput: {} }),
    }),

    defineTool({
      name: 'market_install_command',
      description:
        'Build the exact `dsh plugin --profile <p> add <spec>` commands for plugin ids, or for a search/category. '
        + 'Commands are returned for the user to review and run; this tool never installs anything by itself.',
      parameters: {
        ids: { type: 'string', description: 'Comma-separated plugin ids from market_search' },
        query: { type: 'string', description: 'Search query; used when ids is empty' },
        category: { type: 'string', description: 'Category filter used with query' },
        profile: { type: 'string', description: 'dsh profile name (default web)' },
        limit: { type: 'integer', description: 'Max commands when searching (default 10)' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            profile: { type: 'string', required: true },
            count: { type: 'integer', required: true },
            commands: { type: 'array', required: true, items: { type: 'string' } },
            note: { type: 'string', required: true },
          },
        },
        render: (args, value) => [{
          type: 'text',
          text: `${value.count} command(s) for profile "${value.profile}":\n` + value.commands.map((c) => `  ${c}`).join('\n') + `\n${value.note}`,
        }],
      },
      async execute(args, exec) {
        const registry = await loadRegistry(exec?.signal)
        return installCommands(registry, {
          ids: args.ids ?? '',
          query: args.query ?? '',
          category: args.category,
          profile: args.profile ?? 'web',
          limit: typeof args.limit === 'number' ? args.limit : 10,
        })
      },
      presentCall: (args) => ({ card: 'generic', title: `Install commands (${args.profile ?? 'web'})`, kind: 'other', rawInput: args }),
    }),
  ]
}

/**
 * Register all market tools, plus the in-harness storefront HTTP routes when
 * the host exposes a webServer (web profiles). Headless profiles still get
 * the tools.
 */
export function apply(ctx, config = {}) {
  for (const tool of createTools()) {
    ctx.tools.register(tool)
  }
  const profile = config.profile ?? argvProfile() ?? 'web'
  const routeConfig = { profile, loadRegistry, runner: config.runner }
  try {
    ctx.inject(['webServer'], (host) => {
      mountMarketRoutes(host, routeConfig)
    })
  } catch {
    // Headless profile without a webServer: the agent tools keep working.
  }
}
