import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { expect, it } from 'vitest'
it('pins the platform-neutral gzip header bytes', () => {
  const folder = process.env.BROCREW_CHROME_TEST_ARTIFACT
  expect(folder).toBeTruthy()
  const bytes = fs.readFileSync(path.join(folder!, 'chrome-darwin-arm64.tar.gz'))
  expect([...bytes.subarray(0, 10)]).toEqual([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 2, 255])
})
it('publishes exactly the built archive and its fixed repository pins', () => {
  const folder = process.env.BROCREW_CHROME_TEST_ARTIFACT
  expect(folder).toBeTruthy()
  const entry = JSON.parse(fs.readFileSync(path.join(folder!, 'plugin-list-entry.json'), 'utf8'))
  const bytes = fs.readFileSync(path.join(folder!, 'chrome-darwin-arm64.tar.gz'))
  expect(bytes.length).toBe(entry.targets[0].bytes)
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.targets[0].sha256)
  expect(gunzipSync(bytes).equals(fs.readFileSync(path.join(folder!, 'chrome.tar')))).toBe(true)
  expect(entry.targets[0].url).toBe('https://github.com/brocrew/brocrew-plugin-chrome/releases/download/v' + entry.version + '/chrome-darwin-arm64.tar.gz')
})
