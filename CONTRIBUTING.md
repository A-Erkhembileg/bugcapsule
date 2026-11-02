# Contributing to BugCapsule

BugCapsule is a local-first MV3 extension. Keep changes small, understandable, and testable. Discuss substantial permission, storage, or privacy changes in an issue first.

## Development

Use Node.js 24 LTS and the pnpm version in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm exec playwright install chromium
pnpm test:e2e
pnpm demo
```

Build with `pnpm build` and load `dist/` unpacked through `chrome://extensions`. Rebuild and reload the extension after source changes. This production-build loop is the supported development workflow. `pnpm dev` is available for Vite development; the strict production CSP blocks remote HMR connections, so do not rely on live extension hot reload.

## Pull requests

- Describe a concrete problem, the resulting behavior, and tests actually run.
- Include a regression test for privacy, capture lifecycle, or serialization changes.
- Check the production build; injected functions must remain self-contained after bundling.
- Verify both themes and keyboard interaction for UI changes.
- Use synthetic data in screenshots, fixtures, bug reports, and traces.
- Never commit report downloads, browser profiles, credentials, or real personal data.
- Keep the public JSON schema synchronized with the Zod export schema; unit tests verify equivalence.
- Preserve the no-network policy and minimal manifest permissions. Changes require explicit design discussion and documentation.

By contributing, you agree to license contributions under the project's MIT license and follow the [Code of Conduct](CODE_OF_CONDUCT.md). Do not add dependencies without explaining their role and checking license compatibility.
