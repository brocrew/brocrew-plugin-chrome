import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { expect, it } from 'vitest'
import { assertOwnProfileDir } from '../src/shared/browser/launchGuard.js'
it('keeps the own-profile launch fence, without starting a browser', () => {
  expect(() => assertOwnProfileDir({ profileDir: '' })).toThrow()
  expect(() =>
    assertOwnProfileDir({ profileDir: '/fictional/default' }, ['/fictional/default']),
  ).toThrow()
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-launch-'))
  try {
    expect(() =>
      assertOwnProfileDir({ profileDir: path.join(home, 'fern') }, ['/fictional/default']),
    ).not.toThrow()
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})
