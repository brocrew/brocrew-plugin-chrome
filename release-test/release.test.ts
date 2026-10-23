import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { expect, it } from 'vitest'
const names = ['chrome-darwin-arm64', 'chrome-win32-x64']
it('pins the platform-neutral gzip header bytes', () => {
  const folder = process.env.BROCREW_CHROME_TEST_ARTIFACT
  expect(folder).toBeTruthy()
  for (const name of names) {
    const bytes = fs.readFileSync(path.join(folder!, name + '.tar.gz'))
    expect([...bytes.subarray(0, 10)]).toEqual([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 2, 255])
  }
})
it('publishes exactly the built archives and their fixed repository pins, one target each', () => {
  const folder = process.env.BROCREW_CHROME_TEST_ARTIFACT
  expect(folder).toBeTruthy()
  const entry = JSON.parse(fs.readFileSync(path.join(folder!, 'plugin-list-entry.json'), 'utf8'))
  expect(entry.targets.map((one: { os: string; cpu: string }) => 'chrome-' + one.os + '-' + one.cpu)).toEqual(names)
  for (const [index, name] of names.entries()) {
    const target = entry.targets[index]
    const manifest = JSON.parse(fs.readFileSync(path.join(folder!, name, 'package/plugin.json'), 'utf8'))
    expect(manifest.sourceCommit).toBe(entry.sourceCommit)
    expect(manifest.sourceCommit).toBe(process.env.BROCREW_PLUGIN_SOURCE_COMMIT)
    const bytes = fs.readFileSync(path.join(folder!, name + '.tar.gz'))
    expect(bytes.length).toBe(target.bytes)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(target.sha256)
    expect(gunzipSync(bytes).equals(fs.readFileSync(path.join(folder!, name, 'chrome.tar')))).toBe(true)
    expect(target.url).toBe('https://github.com/brocrew/brocrew-plugin-chrome/releases/download/v' + entry.version + '/' + name + '.tar.gz')
  }
})
