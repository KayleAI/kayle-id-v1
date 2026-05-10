# Release channels and publishing

Kayle ID has one production environment and no preview/canary channel — the version on `main` is the version on `kayle.id`. Every merged PR is a candidate for the next release. The release tooling lives in `.github/workflows/release.yml`.

## How a release happens

`release.yml` runs on `workflow_run` of CI (and on manual `workflow_dispatch` from `main`). It does three things:

1. **Detects whether a release is allowed.** The job compares `package.json#version` against the latest `v<x.y.z>` Git tag. If the package version is newer, `release_allowed` is `true` and the workflow continues to the production deploy steps. If it's the same, only the preview steps run.
2. **Builds preview artifacts.** Every push runs `wrangler deploy --dry-run` for each Worker that has changed (or all four, on a release run). The bundles are packaged with `scripts/package-worker-deploy-artifact.mjs` and uploaded as workflow artifacts.
3. **Deploys to production.** When `release_allowed` is `true`, the artifacts are SLSA-attested, downloaded by the deploy jobs, and uploaded to Cloudflare with `wrangler deploy --no-bundle`. The deploy order is fixed:

   ```
   face-matcher → api → platform → verify
   ```

   `face-matcher` deploys first because the API binds to it as a service. `platform` and `verify` deploy in parallel after the API.

## How to cut a release

1. Make sure `main` is green and contains everything you want shipped.
2. Bump `package.json#version` to the next semver. Use a regular PR — the version bump is a normal commit. Title format: `chore: release v<x.y.z>`.
3. Once that PR merges, the next CI run on `main` will detect the new version, run preview builds, request the production approval gate, and then deploy.
4. After deploy succeeds, `release.yml` tags the commit `v<x.y.z>` and creates a GitHub release with the auto-generated changelog.

A release does not require any local `npm publish` / `wrangler deploy` step — never run `wrangler deploy` manually.

## Hotfixes

For an urgent production fix:

1. Branch from `main`, fix the bug, open the PR.
2. Bump the patch version in the same PR (`v1.3.6` → `v1.3.7`).
3. Merge as soon as CI is green.

The same release flow applies — there's no separate hotfix channel. If the fix needs to ship without other queued changes, hold those changes on their branches until after the hotfix release tag lands.

## Production approval

`release.yml` uses GitHub's `environment: production` gate on `approve_production_release`. A maintainer with `production` environment access has to approve the run before any deploy step touches Cloudflare. The deploys themselves run as `bunx wrangler deploy --env production` against an attested artifact, so even an approved run can only deploy bundles that were built by the same workflow.

## What does *not* go through this flow

- Documentation changes under `docs/` — those publish via Mintlify on push to `main`. See [Adding documentation](../docs/adding-documentation.md).
- iOS App Store builds — those have a separate `build_ios` job in `release.yml` that uploads an `.ipa` to App Store Connect when `release_allowed` is `true`. The version bump above triggers the iOS build at the same time.
- Infisical secrets — these are managed in the Infisical dashboard and synced to Cloudflare workers via Infisical's integration. Nothing in this repo pushes secrets at deploy time. See AGENTS.md's "Environment Variables" section.

## Rolling back

Cloudflare Workers retains previous versions; rolling back is "redeploy the previous tag":

1. Identify the previous good tag (e.g. `v1.3.5`).
2. Open a PR that resets `package.json#version` to a higher number than the current bad tag (semver doesn't allow re-using). Cherry-pick the previous good tag's commits (or revert the bad PR).
3. Let `release.yml` ship it.

For an immediate rollback that doesn't wait for CI, a maintainer with Cloudflare access can roll back via the Cloudflare dashboard. Open a follow-up PR to bring the repo state back in line with what's in production.
