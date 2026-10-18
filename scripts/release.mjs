import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { buildChromePackage } from '../plugins/chrome/build.mjs'
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const out = path.resolve(process.argv[2] ?? 'artifact')
const release = await buildChromePackage(out, commit)
const bytes = gzipSync(fs.readFileSync(path.join(out, 'chrome.tar')), { level: 9 })
const name = 'chrome-darwin-arm64.tar.gz'
fs.writeFileSync(path.join(out, name), bytes)
const entry = {
  id: 'chrome', name: 'Chrome',
  description: 'Lets agents use Google Chrome with its own separate profiles: read pages, use sites and save downloads.',
  version: release.version, minAppVersion: '0.0.0', sourceCommit: commit,
  targets: [{ os: 'darwin', cpu: 'arm64',
    url: 'https://github.com/brocrew/brocrew-plugin-chrome/releases/download/v' + release.version + '/' + name,
    sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
    compression: 'tar.gz', manifestSha256: release.manifestSha256 }],
}
fs.writeFileSync(path.join(out, 'plugin-list-entry.json'), JSON.stringify(entry, null, 2) + '\n')
console.log(JSON.stringify({ archiveBytes: bytes.length, sha256: entry.targets[0].sha256 }))
