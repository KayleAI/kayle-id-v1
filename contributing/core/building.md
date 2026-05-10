# Building

The four Cloudflare-hosted surfaces (`apps/api`, `apps/platform`, `apps/verify`, `infra/face-matcher`) are bundled by Wrangler. The iOS app is bundled by Xcode. Everything else is plain Bun.

## Bun + workspace install

```bash
bun install
```

`bun install` is the only install command — `npm`, `yarn`, and `pnpm` are not supported. The `bun.lock` file is the source of truth; CI uses `--frozen-lockfile`.

## Cap'n Proto regeneration

The schema lives at `packages/capnp/verify.capnp` and produces both TypeScript and C++ outputs.

| Output                                    | Consumed by                |
| ----------------------------------------- | -------------------------- |
| `packages/capnp/generated/ts/verify.ts`   | API + verify Workers       |
| `packages/capnp/generated/c/verify.capnp.c++` | iOS app                |

Regenerate after editing the schema:

```bash
# TypeScript only — no native toolchain required
bun run capnp:generate:ts

# Full regen, including C++ for iOS — needs the local capnproto-swift checkout
CAPNPROTO_SWIFT_PATH=~/capnproto-swift bash ./scripts/generate-capnp.sh
```

If you only changed TypeScript-facing fields, the first command is enough. CI runs the TypeScript-only path via `bun run capnp:generate:ts` before any test or build job that needs it (see `.github/actions/setup-bun/action.yml`).

## Wrangler dry-run deploys

Each Cloudflare surface has a `wrangler deploy --dry-run` invocation that bundles the Worker without uploading. This is what CI runs on every PR (`build-workers` matrix in `.github/workflows/ci.yml`) and what you should run locally before opening a PR that touches Worker code.

| Surface              | Working directory      | Command                                                                  |
| -------------------- | ---------------------- | ------------------------------------------------------------------------ |
| Face matcher         | `infra/face-matcher`   | `bunx wrangler deploy --dry-run --outdir .wrangler-out --env production` |
| API                  | `apps/api`             | `bunx wrangler deploy --dry-run --outdir .wrangler-out --minify --env production` |
| Platform             | `apps/platform`        | `bun run build && bunx wrangler deploy --dry-run --outdir .wrangler-out --minify` |
| Verify               | `apps/verify`          | `bun run build && bunx wrangler deploy --dry-run --outdir .wrangler-out --minify --env production` |

Notes:

- Platform and verify need a Vite build first because they're full TanStack Start apps; the Cloudflare Worker is generated from the Vite output.
- The API and face-matcher dry-runs produce `.wrangler-out/` artifacts that mimic what production deploys upload. Delete the directory after inspection — it's gitignored but not auto-cleaned.
- Don't run `wrangler deploy` (without `--dry-run`) locally. Production deploys go through `release.yml` against attested artifacts; see [Release channels and publishing](../repository/release-channels-publishing.md).

## TypeScript checks

There is no separate `bun run typecheck` script — type errors surface during the Wrangler dry-run (esbuild) and during `vite build`. If you want a faster signal while editing, lean on your editor's TypeScript server.

## Linting and formatting

Run the full lint suite:

```bash
bun run lint
```

That chains:

- `bun run lint:format` — Ultracite (Biome) formatting + lint check
- `bun run lint:runtime-logs` — guards against `console.log` etc. in runtime code paths
- `bun run lint:actions` — verifies all GitHub Actions are pinned to a commit SHA

Auto-fix Biome-fixable issues with:

```bash
bun run format   # alias for `ultracite fix`
```

The pre-commit hook runs `ultracite fix` on staged files — see `.husky/pre-commit`. CI runs the full `bun run lint` against the whole repo.

For more on linting, see [Linting](../repository/linting.md).
