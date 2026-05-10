# Adding a new feature

Read [AGENTS.md](../../AGENTS.md) first. TL;DR: prefer modifying existing code, reuse existing abstractions, and keep diffs minimal. This page is the practical follow-up: where each kind of change goes.

## Before you start

1. Search the codebase for similar implementations — duplicating logic is the most common review reason.
2. Skim `AGENTS.md` for the relevant section (component rules, function design, error handling, type safety).
3. Check the [Linear project](https://linear.app/kayle/team/KID) for any in-flight work that overlaps.
4. If the change crosses architectural boundaries (e.g. introducing a new package or moving an abstraction), open a discussion before writing code.

## Where features live

| Change type                                         | Goes in                                                       |
| --------------------------------------------------- | ------------------------------------------------------------- |
| New API endpoint                                    | `apps/api/src/v1/` (or `apps/api/src/auth/` for auth)         |
| New verify socket phase                             | `apps/api/src/v1/verify/`                                     |
| New auth flow / Better Auth plugin                  | `packages/auth/src/server.ts`                                 |
| New Drizzle schema                                  | `packages/database/src/schema/*.ts` + a generated migration   |
| New verify-payload field                            | `packages/capnp/verify.capnp` (regenerate outputs after)      |
| New shared utility                                  | The closest existing package — only create a new one if there is a clear architectural reason |
| Platform UI                                         | `apps/platform/src/`                                          |
| Verify UI                                           | `apps/verify/src/`                                            |
| Email template                                      | `packages/emails/`                                            |
| Background container worker                         | `infra/face-matcher/`                                         |

## Adding an env var

The single source of truth is the env schema in `packages/config/src/env.ts`. When you add a new variable:

1. Add it to the Zod schema in `packages/config/src/env.ts`.
2. Add the key (with a placeholder value) to **both** `apps/api/.env.example` and `infra/face-matcher/.env.example` if the variable is consumed by either Worker. These are inputs to `wrangler types`, so missing keys break the generated `cloudflare-env.d.ts`.
3. Add a sensible default to `scripts/setup-env.ts` so a fresh contributor's `bun run env:setup` produces a working `.env`.
4. If it's a real secret, add it to the Infisical project and update the `secrets.required` list in the relevant `wrangler.jsonc` `env.production` block.
5. Regenerate Cloudflare types: `bun run cf:types` (run from the repo root or per-app).

Don't introduce per-app `.env` files — the local stack reads everything from the single repo-root `.env`.

## Adding a database migration

```bash
cd packages/database
bun run db:generate   # generate a migration from the current schema
bun run db:migrate    # apply it to local Postgres
```

The migration files live in `database/kayle-id/migrations/`. Commit both the schema change and the generated migration in the same PR.

For Better Auth schema changes, regenerate the auth schema first:

```bash
bun run auth:generate
```

That regenerates `packages/database/src/schema/auth.ts` from the Better Auth config and reformats it.

## Adding a Cap'n Proto field

1. Edit `packages/capnp/verify.capnp`. Use the next available field ordinal — never renumber existing fields, that's a wire-incompatible change.
2. Regenerate outputs:

   ```bash
   # TypeScript only
   bun run capnp:generate:ts

   # Full regen including C++ (needed if iOS reads the field)
   CAPNPROTO_SWIFT_PATH=~/capnproto-swift bash ./scripts/generate-capnp.sh
   ```
3. Wire the field into the API worker (`apps/api/src/v1/verify/`), the verify web app (`apps/verify/`), and the iOS app (`apps/ios/`) as needed.

## Logging guidance

- Never log PII in verify-flow logs — counts, algorithm names, and booleans only. Never raw keys, MRZ, names, or document numbers.
- Use the existing `requestLoggingMiddleware` and structured-event helpers rather than `console.log`.
- The `lint:runtime-logs` script blocks `console.log` / `debugger` / `alert` from runtime code; if it fires, route the log through the structured logger.

## Tests

Behavioural changes need tests. See [Testing](./testing.md) for the suite layout. Treat the in-process API tests as the default location for new verify or auth flows; reach for the full websocket suite only when the websocket is in scope.

## Definition of done

A feature PR is ready when:

- `bun run lint` passes
- the relevant test suites pass locally
- the matching `wrangler deploy --dry-run` passes locally if you touched a Worker
- the PR description follows the [PR description guidelines](../repository/pull-request-descriptions.md)
- you've checked `AGENTS.md`'s Definition of Done list
