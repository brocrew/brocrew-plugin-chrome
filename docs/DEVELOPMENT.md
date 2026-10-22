# Building and testing the Chrome plugin

Use Node 22.23.3 and Git. From the repository root:

```sh
npm ci --legacy-peer-deps --ignore-scripts --no-audit --no-fund
npm ci --prefix plugins/chrome --ignore-scripts --no-audit --no-fund
npm run typecheck
npm run build -- artifact
BROCREW_CHROME_TEST_ARTIFACT="$PWD/artifact" npm test
```

The output folder must not already exist. The build creates macOS arm64 and Windows x64 archives, plus `plugin-list-entry.json` with their download URLs, sizes and SHA-256 checksums. The same source produces reproducible archive bytes. Tests use simulated browsers.

The first supported app target is macOS arm64. Windows and Linux app hosts are not enabled by this release. App-level archive verification and lifecycle tests remain in the BroCrew source repository.

See the [release script](../scripts/release.mjs), [release workflow](../.github/workflows/release.yml) and [BroCrew source](https://github.com/brocrew/brocrew) for the build and app integration details.

The repository is under [Apache-2.0](../LICENSE).

[Back to the plugin](../README.md)
