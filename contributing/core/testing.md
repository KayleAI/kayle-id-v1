# Testing

Most tests run through `bun run test` from the repo root, but a few suites are intentionally excluded from the Turborepo default because they need extra services running.

## Default workspace test command

```bash
bun run test
```

This runs every package-level `test` script that participates in Turborepo. While validating the local setup, it covers:

- `apps/platform`
- `apps/verify`
- `infra/biometric-verifier`

CI exercises the same set in the `test-web` job (`.github/workflows/ci.yml`).

## iOS Swift package tests

```bash
cd apps/ios
swift test
```

The current `Package.swift` only covers the shared model/parser tests, not the full app target. Don't run `xcodebuild` simulator targets from automation — drive Xcode interactively for full app builds.

## Standalone tests not covered by `bun run test`

### Database helper test

```bash
cd packages/database
bun test ./src/raw.test.ts
```

### ICAO PKD parser test

```bash
bun test ./scripts/import-icao-pkd.test.ts
```

## API tests

The API has two flavours — quick in-process tests and a full Wrangler-backed suite that includes the websocket verification flow.

### Generate the API test env first

```bash
cd apps/api
bun ./tests/generate-test-env.ts
```

That writes `apps/api/.env.test` from `/.env.test.example` and injects the trust-bundle JSON used by the API test worker. Re-run it whenever `.env.test.example` changes.

### In-process API tests

These run directly under Bun against the imported app:

```bash
cd apps/api
bun test ./tests/sessions.test.ts
bun test ./tests/verify-handoff.test.ts
bun test ./tests/functions/biometric-verifier-client.test.ts
```

Requirements: Postgres running and the root `.env` present.

### Full API suite (websocket verify flow)

`apps/api/tests/verify.test.ts` opens a real websocket to `ws://127.0.0.1:8787`, so the safest way to run the full suite is to spin up the matching dev workers in three terminals.

**Terminal A — biometric verifier:**

```bash
cd infra/biometric-verifier
bunx wrangler dev --env-file ../../.env.test.example --local --ip 127.0.0.1 --port 8788 --inspector-port 9232
```

**Terminal B — API worker:**

```bash
cd apps/api
bun ./tests/generate-test-env.ts
bunx wrangler dev --env-file ./.env.test --local --ip 127.0.0.1 --port 8787 --inspector-port 9230
```

**Terminal C — tests:**

```bash
cd apps/api
bun test
```

The `test-api` job in `.github/workflows/ci.yml` runs the same flow with health-checked Postgres + Redis service containers.

## Conventions

- Write assertions inside `it()` or `test()` blocks — never at the top level of a file.
- Use async/await; don't mix done callbacks into async tests.
- Don't commit `.only` or `.skip` markers.
- Keep `describe` nesting shallow — flat suites read better.
- Don't mock the database in tests that exercise schema or migration paths. Hit a real Postgres so a broken migration fails CI rather than slipping into prod.

For running specific suites in watch mode while you're iterating on a feature, `bun test --watch <path>` is your friend.
