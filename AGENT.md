# Agent Guidelines

These instructions apply to the entire repository.

## Development workflow

- Use Yarn (classic v1) for dependency management and scripts. Avoid `npm install` so the workspaces stay in sync.
- When you change any TypeScript, JavaScript, or configuration that affects runtime behaviour, run:
  - `yarn test` to execute the Jest suite across the workspace.
  - Optionally `yarn lerna-test` if you need to exercise package-specific scripts.
- Documentation-only updates do not require running tests.

## Code style

- Follow the existing Prettier-driven formatting; do not add manual lint overrides or wrap imports in `try/catch` blocks.
- Prefer explicit, named imports/exports where possible and keep module boundaries aligned with the current folder structure.

## Documentation expectations

- Update `readme.md` when adding new packages, scripts, or high-level concepts so the monorepo overview stays current.
- Keep examples under `examples/` in sync with any breaking API changes.
