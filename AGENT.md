# Agent Guidelines

These instructions apply to the entire repository.

## Development workflow

- Use Yarn (classic v1) for dependency management and scripts. Avoid `npm install` so the workspaces stay in sync.
- When you change any TypeScript, JavaScript, or configuration that affects runtime behaviour, run:
  - `yarn test` to execute the Jest suite across the workspace.
  - Optionally `yarn lerna-test` if you need to exercise package-specific scripts.
- Documentation-only updates do not require running tests.

## Release workflow

- Bump the target package version in its `package.json` and commit the change alongside any pending release files.
- Build the package artefacts with `yarn workspace <package-name> run compile` to refresh `dist/` prior to publishing.
- Publish with `npm publish --otp <two-factor-code>` from the package directory; reuse the provided OTP only once per npm prompt.
- Push the release commit (and tag if applicable) after a successful publish so the repository state matches the registry.

## Code style

- Follow the existing Prettier-driven formatting; do not add manual lint overrides or wrap imports in `try/catch` blocks.
- Prefer explicit, named imports/exports where possible and keep module boundaries aligned with the current folder structure.

## Documentation expectations

- Update `readme.md` when adding new packages, scripts, or high-level concepts so the monorepo overview stays current.
- Keep examples under `examples/` in sync with any breaking API changes.
