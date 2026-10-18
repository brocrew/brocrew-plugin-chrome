import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { loadConfig } from '../src/config.js'
import { startAgentChrome } from '../src/app.js'
import { createProfileStore } from '../src/profiles/store.js'
import { silentLogger } from '../src/logger.js'
import { FakeBrowser, FakePage, asPage } from './fakes.js'

vi.mock('playwright-core', () => ({
  chromium: {
    launch: () => {
      throw new Error('Real Chrome is forbidden in these tests')
    },
    launchPersistentContext: () => {
      throw new Error('Real Chrome is forbidden in these tests')
    },
  },
}))
const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
})
const temporary = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-chrome-'))
  cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}
const mcpToken = 'fictional-mcp-'.repeat(8)
const adminToken = 'fictional-person-'.repeat(8)
function configured() {
  const home = temporary()
  const authPath = path.join(home, 'fixture-auth.json')
  fs.writeFileSync(authPath, JSON.stringify({ mcpToken, adminToken }), { mode: 0o600 })
  return loadConfig({ BROCREW_CHROME_DATA: home, BROCREW_CHROME_AUTH: authPath })
}
async function boot() {
  const config = configured(),
    store = createProfileStore({ home: config.home }),
    browser = new FakeBrowser(store.dirOf)
  const server = await startAgentChrome(config, { browser, store, logger: silentLogger })
  cleanup.push(() => server.close())
  const port = (server.httpServer.address() as { port: number }).port
  const url = `http://127.0.0.1:${port}`
  async function request(endpoint: string, token?: string, body?: unknown, origin?: string) {
    const response = await fetch(url + endpoint, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(origin ? { origin } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, body: await response.json() }
  }
  return { config, store, browser, server, url, request }
}
describe('private Chrome package', () => {
  it('requires explicit private paths and distinct private auth, with no workspace fallback', () => {
    expect(() => loadConfig({})).toThrow('Plugin unavailable')
    expect(() => loadConfig({ BROCREW_CHROME_DATA: 'relative' })).toThrow('Plugin unavailable')
    const config = configured()
    expect(config.workspace).toBe(path.join(config.home, 'files'))
    expect(config.downloadsRoot).toBe(path.join(config.home, 'downloads'))
    if (process.platform !== 'win32')
      for (const dir of [config.home, config.workspace, config.downloadsRoot])
        expect(fs.statSync(dir).mode & 0o777).toBe(0o700)
    fs.writeFileSync(config.authPath, JSON.stringify({ mcpToken, adminToken: mcpToken }))
    expect(() =>
      loadConfig({ BROCREW_CHROME_DATA: config.home, BROCREW_CHROME_AUTH: config.authPath }),
    ).toThrow('Plugin unavailable')
  })
  it('accepts only an absolute host-selected browser executable', () => {
    const config = configured()
    const env = { BROCREW_CHROME_DATA: config.home, BROCREW_CHROME_AUTH: config.authPath }
    expect(
      loadConfig({ ...env, BROCREW_CHROME_EXECUTABLE: path.join(config.home, 'fictional-browser') })
        .browser?.executablePath,
    ).toBe(path.join(config.home, 'fictional-browser'))
    expect(() =>
      loadConfig({ ...env, BROCREW_CHROME_EXECUTABLE: 'fictional-relative-browser' }),
    ).toThrow('Plugin unavailable')
  })
  it('refuses a linked auth file and a world-readable auth file without quoting it', () => {
    const config = configured(),
      link = path.join(config.home, 'linked.json')
    fs.symlinkSync(config.authPath, link)
    expect(() =>
      loadConfig({ BROCREW_CHROME_DATA: config.home, BROCREW_CHROME_AUTH: link }),
    ).toThrow('Plugin unavailable')
    if (process.platform !== 'win32') {
      fs.chmodSync(config.authPath, 0o644)
      expect(() =>
        loadConfig({ BROCREW_CHROME_DATA: config.home, BROCREW_CHROME_AUTH: config.authPath }),
      ).toThrow('Plugin unavailable')
    }
  })
  it('authenticates health and admin separately from tools, and refuses browser origins', async () => {
    const { request } = await boot()
    expect((await request('/healthz')).status).toBe(401)
    expect((await request('/v1/profiles', mcpToken)).status).toBe(401)
    expect((await request('/v1/tabs', mcpToken)).status).toBe(401)
    expect((await request('/mcp', adminToken, {})).status).toBe(401)
    expect((await request('/healthz', adminToken)).status).toBe(200)
    expect(
      (await request('/v1/profiles', adminToken, undefined, 'https://fictional.invalid')).status,
    ).toBe(403)
  })
  it('only the person enables profiles and opens windows; tool discovery and use work with fakes', async () => {
    const { request, browser, url } = await boot()
    expect((await request('/v1/profiles', mcpToken, { name: 'fern' })).status).toBe(401)
    expect((await request('/v1/profiles', adminToken, { name: 'fern' })).status).toBe(201)
    const client = new Client({ name: 'fictional-agent', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(url + '/mcp'), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } },
    })
    await client.connect(transport)
    cleanup.push(() => client.close())
    const tools = await client.listTools()
    expect(tools.tools.some((tool) => tool.name === 'open_tab')).toBe(true)
    const refused = await client.callTool({
      name: 'open_tab',
      arguments: { profile: 'fern', url: 'https://fictional.invalid/' },
    })
    expect(JSON.stringify(refused)).toContain('not enabled')
    expect(browser.launches).toHaveLength(0)
    expect((await request('/v1/profiles/fern/flags', adminToken, { enabled: true })).status).toBe(
      200,
    )
    const result = await client.callTool({
      name: 'open_tab',
      arguments: { profile: 'fern', url: 'https://fictional.invalid/' },
    })
    expect(JSON.stringify(result)).toContain('t')
    expect(browser.launches).toEqual([{ profile: 'fern', mode: 'headless' }])
    expect((await request('/v1/profiles/fern/open', adminToken, {})).status).toBe(202)
    expect(browser.launches.at(-1)).toEqual({ profile: 'fern', mode: 'visible' })
    const duringWindow = await client.callTool({
      name: 'open_tab',
      arguments: { profile: 'fern', url: 'https://fictional.invalid/shared' },
    })
    expect(JSON.stringify(duringWindow)).toContain('https://fictional.invalid/shared')
    browser.endWindow('fern')
    expect((await request('/v1/profiles/fern/flags', adminToken, { enabled: false })).status).toBe(
      200,
    )
    expect(browser.state('fern')).toBeNull()
  })
  it('returns bounded typed tabs, excludes expired generations and strips URL credentials/query', async () => {
    const { request, browser, server, store } = await boot()
    store.create('willow', 'panel')
    store.setFlags('willow', { enabled: true })
    const { generation } = await browser.ensure('willow', 'headless')
    const page = new FakePage()
    page.urlValue = 'https://fictional:madeup@fictional.invalid/path?q=private#part'
    server.tabs.add('willow', generation, asPage(page))
    const reply = await request('/v1/tabs', adminToken)
    expect(reply.status).toBe(200)
    expect(reply.body.tabs).toEqual([
      {
        id: expect.any(String),
        profile: 'willow',
        url: 'https://fictional.invalid/path',
        title: 'Title',
      },
    ])
    await browser.close('willow')
    expect((await request('/v1/tabs', adminToken)).body.tabs).toEqual([])
  })
})
