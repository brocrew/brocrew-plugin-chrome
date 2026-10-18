import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { BrowserContext } from 'playwright-core'
import { expect, it } from 'vitest'
import { ChromeBrowser } from '../src/browser/chromeBrowser.js'
import type { ChromiumLaunchOptions } from '../src/shared/browser/browser-launch.js'

it('keeps visible-browser staging under private downloads and closes its fake context', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-chrome-browser-'))
  fs.mkdirSync(path.join(home, 'profiles', 'fern'), { recursive: true })
  const sent: Array<{ method: string; params: Record<string, unknown> }> = []
  class Context extends EventEmitter {
    ended = false
    driver = new EventEmitter() as EventEmitter & {
      newBrowserCDPSession?: unknown
      isConnected?: unknown
    }
    constructor() {
      super()
      this.driver.newBrowserCDPSession = async () => ({
        on() {},
        send: async (method: string, params: Record<string, unknown>) => {
          sent.push({ method, params })
        },
      })
      this.driver.isConnected = () => !this.ended
    }
    pages() {
      return []
    }
    browser() {
      return this.driver
    }
    async close() {
      this.ended = true
      this.emit('close')
    }
  }
  const launches: ChromiumLaunchOptions[] = []
  const context = new Context()
  const browser = new ChromeBrowser({
    dirOf: (profile) => path.join(home, 'profiles', profile),
    downloadsRoot: path.join(home, 'downloads'),
    lockHeld: async () => false,
    killChrome: async () => {
      throw new Error('No process should be killed')
    },
    ua: {
      get: async () => ({ userAgent: 'fictional', chromeVersion: '1' }),
      invalidate() {},
      peek: () => null,
    },
    launchContext: async (opts) => {
      launches.push(opts)
      return context as unknown as BrowserContext
    },
  })
  try {
    await browser.ensure('fern', 'visible')
    expect(launches[0].profileDir).toBe(path.join(home, 'profiles', 'fern'))
    expect(launches[0].downloadsPath!.startsWith(path.join(home, 'downloads') + path.sep)).toBe(
      true,
    )
    expect(launches[0].headless).toBe(false)
    if (process.platform !== 'win32')
      expect(fs.statSync(path.join(home, 'downloads')).mode & 0o777).toBe(0o700)
    expect(sent.some((entry) => entry.method === 'Browser.setDownloadBehavior')).toBe(true)
    for (const entry of sent.filter((v) => v.method === 'Browser.setDownloadBehavior'))
      expect(entry.params).toMatchObject({
        behavior: 'allowAndName',
        downloadPath: launches[0].downloadsPath,
      })
    await browser.closeAll()
    expect(context.ended).toBe(true)
    expect(fs.readdirSync(path.join(home, 'downloads'))).toEqual([])
  } finally {
    await browser.closeAll()
    fs.rmSync(home, { recursive: true, force: true })
  }
})
