---
description: Release a new version of @schemeless/event-store monorepo
---

# Release Workflow for @schemeless/event-store

This workflow guides you through releasing a new version of the monorepo using tag-triggered publishing.

## Prerequisites

- All changes merged to `master` branch
- All tests passing
- You have write access to the repository
- NPM token is configured in GitHub secrets (environment: `npm-publish`)

## Steps

### 1. Verify current state

```bash
git checkout master
git pull origin master
yarn install --frozen-lockfile
yarn lerna run compile
yarn lerna run test
```

### 2. Bump version

Decide on the new version number (e.g., `3.0.5`) and update:

```bash
# Update lerna.json
# Manually edit: "version": "3.0.5"

# Update all package.json files
# All packages in this monorepo use fixed versioning
# Manually edit each packages/*/package.json or use:
yarn lerna version 3.0.5 --no-push --no-git-tag-version --yes
```

### 3. Update CHANGELOG.md

Add a new section at the top:

```markdown
## [3.0.5] - 2026-02-13

### Added
- Feature description

### Fixed
- Bug fix description
```

### 4. Commit and tag

```bash
git add .
git commit -m "chore(release): v3.0.5"
git tag v3.0.5
```

### 5. Push to trigger release

// turbo
```bash
git push origin master --tags
```

This will automatically trigger the `publish.yml` workflow which will:
1. Validate tag version matches `lerna.json`
2. Build all packages
3. Run all tests
4. Publish to npm using `lerna publish from-package`
5. Create a GitHub Release

### 6. Monitor the release

// turbo
```bash
# Wait a few seconds for GitHub to register the workflow run
sleep 5

# Get the latest run for the publish workflow
gh run list --workflow=publish.yml --limit=1

# Watch the run (get the run ID from the command above)
gh run watch
```

Or monitor via GitHub Actions UI:
```bash
gh workflow view publish.yml --web
```

### 7. Verify the release

After the workflow completes:

// turbo
```bash
# Check npm publication
npm view @schemeless/event-store version

# Check GitHub Release
gh release view v3.0.5
```

## Troubleshooting

### Tag version mismatch

If you see `Tag version does not match lerna.json version`:
- Delete the tag: `git tag -d v3.0.5 && git push origin :refs/tags/v3.0.5`
- Fix `lerna.json` version
- Recreate the tag and push again

### Publish dry-run

To test the workflow without actually publishing:

```bash
# Push the tag first
git push origin master --tags

# Then manually trigger with dry-run
gh workflow run publish.yml --field dry_run=true

# Monitor
gh run watch
```

### Failed release

If the workflow fails:

```bash
# View the failed run logs
gh run view --log

# Fix the issue, then re-run the workflow
gh run rerun <run-id>
```

## Quick reference

```bash
# One-liner for version bump (after manual CHANGELOG update)
NEW_VERSION="3.0.5" && \
  yarn lerna version ${NEW_VERSION} --no-push --no-git-tag-version --yes && \
  git add . && \
  git commit -m "chore(release): v${NEW_VERSION}" && \
  git tag v${NEW_VERSION} && \
  git push origin master --tags && \
  sleep 5 && \
  gh run watch
```
