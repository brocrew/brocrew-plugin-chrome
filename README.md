# Chrome plugin for BroCrew

This repository is a clean source export of the Chrome plugin maintained and integration-tested with BroCrew. It contains no app history or client data. Its private release workflow builds a deterministic archive, runs tests with fake browsers and emits the entry for BroCrew’s plugin list. Users install from Settings → Plugins; they run no commands and supply no key or token.

The first supported app target is macOS arm64. Windows and Linux app hosts are not enabled by this release. App-level archive verification and lifecycle tests remain in the BroCrew source repository.
