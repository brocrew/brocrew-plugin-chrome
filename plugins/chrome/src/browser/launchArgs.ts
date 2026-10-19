import type { BrowserMode } from './profileBrowser.js'

export interface LaunchArgsInput {
  profileDir: string
  mode: BrowserMode

  sync: boolean

  extensions: boolean

  noSandbox: boolean

  noTestType: boolean
  platform?: NodeJS.Platform

  extraArgs?: readonly string[]
}

export function launchArgs(i: LaunchArgsInput): string[] {
  const platform = i.platform ?? process.platform
  return [
    `--user-data-dir=${i.profileDir}`,
    '--remote-debugging-pipe',
    '--disable-blink-features=AutomationControlled',
    ...(i.noTestType ? [] : ['--test-type']),
    '--password-store=basic',
    '--use-mock-keychain',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-search-engine-choice-screen',
    ...(i.sync ? [] : ['--disable-sync']),
    ...(i.extensions ? [] : ['--disable-extensions']),
    ...(i.mode === 'headless' ? ['--headless', '--hide-scrollbars', '--mute-audio'] : []),
    ...(platform === 'linux' ? ['--disable-dev-shm-usage'] : []),
    ...(i.noSandbox ? ['--no-sandbox'] : []),
    ...(i.extraArgs ?? []),
    'about:blank',
  ]
}
