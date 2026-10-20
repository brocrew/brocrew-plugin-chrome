import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { buildChromePackage, CHROME_TARGETS } from '../plugins/chrome/build.mjs'
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const out = path.resolve(process.argv[2] ?? 'artifact')
fs.mkdirSync(out)
const targets = []
let version
for (const target of CHROME_TARGETS) {
  const name = 'chrome-' + target.os + '-' + target.cpu
  const built = path.join(out, name)
  const release = await buildChromePackage(built, commit, target)
  version = release.version
  const bytes = gzipSync(fs.readFileSync(path.join(built, 'chrome.tar')), { level: 9 })
  // zlib emits a host-specific OS byte. Canonicalize it; payload and trailer stay unchanged.
  bytes[9] = 255
  fs.writeFileSync(path.join(out, name + '.tar.gz'), bytes)
  targets.push({ os: target.os, cpu: target.cpu,
    url: 'https://github.com/brocrew/brocrew-plugin-chrome/releases/download/v' + version + '/' + name + '.tar.gz',
    sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
    compression: 'tar.gz', manifestSha256: release.manifestSha256 })
}
const entry = {
  id: 'chrome', name: 'Chrome',
  description: 'Lets agents use Google Chrome with its own separate profiles: read pages, use sites and save downloads.',
  version, minAppVersion: '0.0.0', sourceCommit: commit, targets,
}
fs.writeFileSync(path.join(out, 'plugin-list-entry.json'), JSON.stringify(entry, null, 2) + '\n')
console.log(JSON.stringify(targets.map((one) => ({ os: one.os, cpu: one.cpu, bytes: one.bytes, sha256: one.sha256 }))))
