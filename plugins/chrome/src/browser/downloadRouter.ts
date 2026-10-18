import fs from 'node:fs'
import { privateFolder } from '../privatePaths.js'
import path from 'node:path'
import type { Logger } from '../logger.js'
import { silentLogger } from '../logger.js'
import { WINDOWS_DEVICE } from '../files.js'
export interface DownloadSession {
  on(event: string, cb: (params: Record<string, unknown>) => void): unknown
}
export type FrameIds = () => Promise<ReadonlySet<string>>
export interface Capture {
  end(): void
}
interface Rec {
  name: string
  frameId: string
  owner: CaptureImpl | null
  state: 'running' | 'completed'
  placing: boolean
  dest: string | null
  swept: boolean
  decided: Promise<void>
}
const MAX_RECORDS = 500
const MAX_NAME_BYTES = 200
class CaptureImpl implements Capture {
  taken = false
  ended = false
  constructor(
    readonly frames: FrameIds,
    private readonly router: DownloadRouter,
  ) {}
  end(): void {
    if (this.ended) return
    this.ended = true
    this.router.release(this)
  }
}
export interface RouterOptions {
  dir: string
  session: DownloadSession
  nativeDir: () => string
  fallbackDirs?: () => string[]
  logger?: Logger
}
export class DownloadRouter {
  private readonly recs = new Map<string, Rec>()
  private readonly captures = new Set<CaptureImpl>()
  private decisions: Promise<void> = Promise.resolve()
  private readonly logger: Logger
  constructor(private readonly o: RouterOptions) {
    this.logger = o.logger ?? silentLogger
    o.session.on('Browser.downloadWillBegin', (p) => this.begin(p))
    o.session.on('Browser.downloadProgress', (p) => this.progress(p))
  }
  capture(frames: FrameIds): Capture {
    const c = new CaptureImpl(frames, this)
    this.captures.add(c)
    return c
  }
  private begin(p: { guid?: unknown; frameId?: unknown; suggestedFilename?: unknown }): void {
    if (typeof p.guid !== 'string') return
    if (this.recs.size >= MAX_RECORDS) this.recs.delete(this.recs.keys().next().value as string)
    const rec: Rec = {
      name: typeof p.suggestedFilename === 'string' ? p.suggestedFilename : '',
      frameId: typeof p.frameId === 'string' ? p.frameId : '',
      owner: null,
      state: 'running',
      placing: false,
      dest: null,
      swept: false,
      decided: Promise.resolve(),
    }
    this.recs.set(p.guid, rec)
    rec.decided = this.decisions = this.decisions
      .then(() => this.decide(rec))
      .catch(() => undefined)
  }
  private async decide(rec: Rec): Promise<void> {
    if (rec.frameId === '') return
    for (const c of this.captures) {
      if (c.taken || c.ended) continue
      let ids: ReadonlySet<string>
      try {
        ids = await c.frames()
      } catch {
        continue
      }
      if (c.ended || !ids.has(rec.frameId)) continue
      c.taken = true
      rec.owner = c
      return
    }
  }
  private progress(p: { guid?: unknown; state?: unknown }): void {
    if (typeof p.guid !== 'string') return
    const rec = this.recs.get(p.guid)
    if (!rec) return
    const guid = p.guid
    if (p.state === 'canceled') {
      this.recs.delete(guid)
      return
    }
    if (p.state !== 'completed') return
    rec.state = 'completed'
    void rec.decided.then(() => {
      if (!rec.owner) this.place(guid, rec)
    })
  }
  release(c: CaptureImpl): void {
    this.captures.delete(c)
    for (const [guid, rec] of this.recs) {
      if (rec.owner !== c) continue
      rec.owner = null
      if (rec.state === 'completed') this.place(guid, rec)
    }
  }
  sweep(): ReadonlySet<string> {
    const kept = new Set<string>()
    for (const [guid, rec] of this.recs) {
      if (rec.state !== 'completed') continue
      const src = path.join(this.o.dir, guid)
      if (rec.dest) {
        fs.rmSync(src, { force: true })
        continue
      }
      if (this.placeSync(src, rec.name)) rec.swept = true
      else kept.add(guid)
    }
    this.recs.clear()
    return kept
  }
  private dirs(): string[] {
    return [this.o.nativeDir(), ...(this.o.fallbackDirs?.() ?? [])]
  }
  private place(guid: string, rec: Rec): void {
    if (rec.placing || rec.dest) return
    rec.placing = true
    const src = path.join(this.o.dir, guid)
    void (async () => {
      for (const dir of this.dirs()) {
        try {
          const dest = await placeFile(src, dir, rec.name, (d) => {
            rec.dest = d
          })
          if (dest && rec.swept) await fs.promises.rm(dest, { force: true })
          this.recs.delete(guid)
          this.logger.info('download kept for the user', { guid: guid.slice(0, 8) })
          return
        } catch (e) {
          if (!fs.existsSync(src)) {
            this.recs.delete(guid)
            return
          }
          if (rec.dest) {
            this.recs.delete(guid)
            return
          }
          this.logger.warn('a download of the user could not be moved to a download folder', {
            errorCode: code(e),
          })
        }
      }
      rec.placing = false
      this.logger.warn(
        'a download of the user stays in the staging folder until the browser ends',
        { guid: guid.slice(0, 8) },
      )
    })()
  }
  private placeSync(src: string, name: string): boolean {
    if (!fs.existsSync(src)) return true
    for (const dir of this.dirs()) {
      try {
        placeFileSync(src, dir, name)
        return true
      } catch (e) {
        this.logger.warn('a download of the user could not be moved to a download folder', {
          errorCode: code(e),
        })
      }
    }
    return false
  }
}
export function userFileName(
  suggested: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const base = suggested.split(/[\\/]/).pop() ?? ''
  let name = base
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex -- Strip filename control characters.
    .replace(/[\u0000-\u001f\u007f:*?"<>|]/g, '_')
    .replace(/^[. ]+/, '')
    .replace(/[. ]+$/, '')
  if (name === '') name = 'download'
  if (platform === 'win32' && WINDOWS_DEVICE.test(name)) name = `_${name}`
  if (Buffer.byteLength(name) > MAX_NAME_BYTES) {
    const ext = path.extname(name)
    const keep = ext.length < 20 ? ext : ''
    let stem = name.slice(0, name.length - keep.length)
    while (Buffer.byteLength(stem) + Buffer.byteLength(keep) > MAX_NAME_BYTES)
      stem = stem.slice(0, -1)
    name = (stem + keep).replace(/[. ]+$/, '') || 'download'
  }
  return name
}
function* candidates(name: string): Generator<string> {
  yield name
  const ext = path.extname(name)
  const stem = name.slice(0, name.length - ext.length)
  for (let i = 1; i < 10000; i++) yield `${stem} (${i})${ext}`
}
const CROSS_DEVICE = new Set(['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EMLINK'])
const code = (e: unknown): string => (e as NodeJS.ErrnoException)?.code ?? ''
const tempName = (dir: string): string =>
  path.join(dir, `.agent-chrome-${process.pid}-${Math.random().toString(36).slice(2, 10)}.part`)
async function copyInto(src: string, dest: string): Promise<void> {
  const tmp = tempName(path.dirname(dest))
  try {
    await fs.promises.copyFile(src, tmp, fs.constants.COPYFILE_EXCL)
    const fh = await fs.promises.open(tmp, 'r+')
    try {
      await fh.sync()
    } finally {
      await fh.close()
    }
    try {
      await fs.promises.link(tmp, dest)
    } catch (e) {
      if (code(e) === 'EEXIST') throw e
      if (fs.existsSync(dest)) throw Object.assign(new Error('exists'), { code: 'EEXIST' })
      await fs.promises.rename(tmp, dest)
    }
  } finally {
    await fs.promises.rm(tmp, { force: true })
  }
}
function copyIntoSync(src: string, dest: string): void {
  const tmp = tempName(path.dirname(dest))
  try {
    fs.copyFileSync(src, tmp, fs.constants.COPYFILE_EXCL)
    const fd = fs.openSync(tmp, 'r+')
    try {
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    try {
      fs.linkSync(tmp, dest)
    } catch (e) {
      if (code(e) === 'EEXIST') throw e
      if (fs.existsSync(dest)) throw Object.assign(new Error('exists'), { code: 'EEXIST' })
      fs.renameSync(tmp, dest)
    }
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}
export async function placeFile(
  src: string,
  dir: string,
  suggested: string,
  placed?: (dest: string) => void,
): Promise<string | null> {
  if (!fs.existsSync(src)) return null
  privateFolder(path.dirname(dir), dir, true)
  for (const name of candidates(userFileName(suggested))) {
    const dest = path.join(dir, name)
    try {
      try {
        await fs.promises.link(src, dest)
      } catch (e) {
        if (!CROSS_DEVICE.has(code(e))) throw e
        await copyInto(src, dest)
      }
    } catch (e) {
      if (code(e) === 'EEXIST') continue
      throw e
    }
    placed?.(dest)
    await fs.promises.rm(src, { force: true })
    return dest
  }
  throw new Error('no free file name')
}
export function placeFileSync(src: string, dir: string, suggested: string): string | null {
  if (!fs.existsSync(src)) return null
  privateFolder(path.dirname(dir), dir, true)
  for (const name of candidates(userFileName(suggested))) {
    const dest = path.join(dir, name)
    try {
      try {
        fs.linkSync(src, dest)
      } catch (e) {
        if (!CROSS_DEVICE.has(code(e))) throw e
        copyIntoSync(src, dest)
      }
    } catch (e) {
      if (code(e) === 'EEXIST') continue
      throw e
    }
    fs.rmSync(src, { force: true })
    return dest
  }
  throw new Error('no free file name')
}
