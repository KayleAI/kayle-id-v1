# Instructions for running Kayle ID locally

## Local stack overview

The local development stack currently consists of:

- `apps/api`: Cloudflare Worker API on `http://127.0.0.1:8787`
- `apps/platform`: platform web app on `https://localhost:3000`
- `apps/verify`: verification web app on `http://localhost:2999`
- `infra/postgres`: local Postgres on `postgres://postgres:postgres@localhost:6432/kayle-id`
- `infra/face-matcher`: Cloudflare Worker + containerized face matcher on `http://127.0.0.1:8788`
- `apps/ios`: iOS app on a physical iPhone (requires Xcode, `xcrun devicectl`, and a physical iPhone — a simulator will not work here)

## 0. Prerequisites

### Required software

Install these first:

- Bun 1.3.6+
- Docker Desktop
- Xcode + Xcode Command Line Tools
- Swift toolchain
- Python 3
- CMake
- Cap'n Proto compiler (`capnpc`)
- Git

### Setup the repo

#### Cloning the repo

```bash
git clone https://github.com/kayle-id/kayle-id.git ~/kayle-id
```

#### Downloading a release of the repo

```bash
# Copy the release .zip file to ~/kayle-id
unzip ~/path/to/kayle-id-X.X.X.zip -d ~/kayle-id
```

From the repo root:

```bash
bun install
```

### Install and build `capnproto-swift`

The current iOS project and the Cap'n Proto generation scripts both assume a local checkout at `~/capnproto-swift`.

Set it up like this:

```bash
mkdir -p ~/
git clone https://github.com/arsenstorm/capnproto-swift.git ~/capnproto-swift
git -C ~/capnproto-swift submodule update --init --recursive
bash ~/capnproto-swift/scripts/build-xcframework.sh
```

Notes:

- `apps/ios/Kayle ID.xcodeproj` currently hardcodes this package path as `~/capnproto-swift`.
- `scripts/generate-capnp.sh` also defaults `CAPNPROTO_SWIFT_PATH` to `~/capnproto-swift`.
- If you keep that repo somewhere else, you must both set `CAPNPROTO_SWIFT_PATH` for scripts and repoint the local Swift package in Xcode.

### Generate Cap'n Proto outputs if they are missing

Fresh clones may not have `packages/capnp/generated/`.

If either of these paths is missing:

- `packages/capnp/generated/ts/verify.ts`
- `packages/capnp/generated/c/verify.capnp.c++`

run:

```bash
CAPNPROTO_SWIFT_PATH=~/capnproto-swift bash ./scripts/generate-capnp.sh
```

`generate-capnp.sh` generates both the TypeScript and C++ outputs. The C++ outputs are required for the iOS app.

## 1. Environment variables

The local stack reads everything from a single `.env` at the repo root. You only need one of two commands to populate it.

**Outside contributors — `bun run env:setup`.**

```bash
bun run env:setup
```

This writes a working `.env` with random hex for `AUTH_SECRET`, `KAYLE_INTERNAL_TOKEN`, and `FACE_MATCHER_SECRET`, and dummy values for Google OAuth and Resend. The dev API logs the magic OTP and email body instead of calling those services, so dummies are sufficient for the full sign-in flow. The script refuses to overwrite an existing `.env` — delete it first if you want a fresh bootstrap.

**Maintainers — `bun run env:pull`.**

After installing the [Infisical CLI](https://infisical.com/docs/cli/overview) and running `infisical login` once:

```bash
bun run env:pull           # pulls the dev environment from Infisical
bun run env:pull -- staging  # pull a different env if needed
```

This rewrites the repo-root `.env` with the real shared dev secrets. The Infisical workspace is pinned in `.infisical.json`.

### Optional dev-only overrides

Add these to `.env` only if you need them:

- `KAYLE_DEV_API_BASE_URL=http://<reachable-host>:8787` — required for the physical iPhone build. Do **not** use `localhost`; use an IP or hostname reachable from the phone (a Tailscale IP works well).
- `KAYLE_DEMO_API_KEY` / `KAYLE_DEMO_ORG_SLUG` — required only if you want `https://localhost:3000/demo` to create real sessions against the local API. `KAYLE_DEMO_ORG_SLUG` defaults to `"kayle"`.
- `REDIS_URL` / `REDIS_TOKEN` — only needed if you wire Redis-backed behavior.
- Real `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — only if you want to test real Google sign-in locally.
- Real `RESEND_API_KEY` — only if you want to test real outbound email locally.

### Optional `apps/verify/.env`

The verify app already defaults to the local API host. If you need to override:

```dotenv
PUBLIC_API_HOST=127.0.0.1:8787
PUBLIC_API_PROTOCOL=ws
```

### Test-only `apps/api/.env.test`

Do not hand-author this file. Generate it when you need API tests:

```bash
cd apps/api
bun ./tests/generate-test-env.ts
```

That command creates `apps/api/.env.test` from `/.env.test.example` and injects the generated trust bundle JSON used by the API test worker.

## 2. Launch the database via Docker

From the repo root:

```bash
bun run db:start
```

Useful companion commands:

```bash
bun run db:logs
bun run db:stop
bun run db:clean
```

Notes:

- The Docker Compose file is `infra/postgres/compose.yml`.
- Postgres listens on host port `6432`.
- `database/kayle-id/seed.sql` is currently empty, so there is no separate app-data seed to apply here beyond migrations.

## 3. Seed the local dataset

The meaningful local seed step is the ICAO PKD trust-store import. This populates the local D1 trust store used by document authenticity checks.

Download the ICAO PKD LDIF files from the [ICAO website](https://pkddownload.icao.int/downloads).

Run:

```bash
bun run dev:seed -- --objects /path/to/icaopkd-001-complete-XXXXX.ldif --master-lists /path/to/icaopkd-002-complete-XXX.ldif --output ./temp/icao-pkd-trust-store.sql
```

What this does:

- starts local Postgres if needed
- waits for Postgres to become ready
- runs Drizzle migrations for the app database
- verifies or regenerates Cap'n Proto outputs if they are stale
- builds a trust-store SQL bundle from the ICAO PKD LDIFs
- applies local D1 trust-store migrations
- imports the generated trust-store SQL into local D1

## 4. Launch all apps

From the repo root:

```bash
bun run dev
```

That starts:

- API worker
- face matcher worker
- platform app
- verify app

Local URLs:

- API health: `http://127.0.0.1:8787/`
- API docs: `http://127.0.0.1:8787/reference`
- face matcher health: `http://127.0.0.1:8788/health`
- platform: `https://localhost:3000`
- verify: `http://localhost:2999`

Notes:

- The platform app uses a local HTTPS cert via Vite Basic SSL. On first launch, your browser may warn about the self-signed certificate.
- The face matcher's first boot can take longer because Wrangler builds its container image and downloads the OpenCV ONNX models.
- If you only want to start one app at a time, use the individual workspace commands from each package's `package.json`.

### Optional: use the platform UI to create a demo API key

If you want the local `/demo` route to create sessions:

1. Open `https://localhost:3000/sign-in`.
2. Submit your email.
3. Watch the API logs for the `auth.magic_otp.generated` event in development.
4. Complete sign-in and create/select an organization.
5. Create an API key in the platform UI.
6. Put that key into `apps/platform/.env` as `KAYLE_DEMO_API_KEY=...`.
7. Restart the platform app.

## 5. Launch the iOS app

### Current constraints

The current iOS flow assumes:

- a physical iPhone, not just the simulator
- camera access
- NFC access
- working Apple code signing
- a reachable `KAYLE_DEV_API_BASE_URL`

The app defaults to production if `KAYLE_DEV_API_BASE_URL` is missing, so do not skip that variable if you want local end-to-end behavior.

### One-time Xcode signing setup

Before using the script, open the project once in Xcode:

```bash
open "apps/ios/Kayle ID.xcodeproj"
```

Then:

1. Select the `Kayle ID` target.
2. Set your own Apple development team under Signing.
3. If automatic signing fails, change the bundle identifier from the current `kayle.id` to something unique for your account.

The project currently hardcodes a development team and bundle identifier, so another machine usually needs this manual setup first.

### Ensure the local backend is running

Keep these running first:

- Postgres
- the local trust-store seed has been applied
- `bun run dev`

### Use a phone-reachable API base URL

Set `KAYLE_DEV_API_BASE_URL` in the root `.env` to a URL the phone can reach, for example:

```dotenv
KAYLE_DEV_API_BASE_URL=http://192.168.x.x:8787
```

or a Tailscale IP / hostname.

### Run on a connected device

From the repo root:

```bash
bash ./apps/ios/scripts/run-on-connected-device.sh --api-base-url http://<reachable-host>:8787
```

If you have multiple connected phones:

```bash
bash ./apps/ios/scripts/run-on-connected-device.sh --device "<udid-or-device-name>" --api-base-url http://<reachable-host>:8787
```

What this script does:

- resolves a connected physical iPhone destination
- builds the app with `xcodebuild`
- installs it with `xcrun devicectl`
- launches it with `KAYLE_DEV_API_BASE_URL` injected into the process environment

### If the build fails

Check these first:

- `packages/capnp/generated/c/verify.capnp.c++` exists
- `~/Work/capnproto-swift` exists and has been built with `scripts/build-xcframework.sh`
- Xcode signing is configured for your Apple account
- the connected device is trusted and visible to Xcode

## 6. Test suites

### Default workspace test command

From the repo root:

```bash
bun run test
```

This currently runs the package-level `test` scripts that exist in the monorepo. While validating this document, it passed for:

- `apps/platform`
- `apps/verify`
- `infra/face-matcher`

### iOS Swift package tests

From the repo root:

```bash
cd apps/ios
swift test
```

This passed while validating this document. The current `Package.swift` only covers the shared model/parser tests, not the full app target.

### Standalone tests not covered by `bun run test`

#### Database helper test

```bash
cd packages/database
bun test ./src/raw.test.ts
```

#### ICAO PKD parser test

```bash
bun test ./scripts/import-icao-pkd.test.ts
```

### API tests

#### Generate API test env first

```bash
cd apps/api
bun ./tests/generate-test-env.ts
```

#### In-process API tests

These run directly in Bun against the imported app and were validated while writing this file:

```bash
cd apps/api
bun test ./tests/sessions.test.ts
bun test ./tests/verify-handoff.test.ts
bun test ./tests/functions/face-matcher-client.test.ts
```

These require:

- Postgres running
- the root `.env` present

#### Full API suite including websocket verification flow

`apps/api/tests/verify.test.ts` opens a real websocket to `ws://127.0.0.1:8787`, so the safest way to run the full API suite is:

Terminal A:

```bash
cd infra/face-matcher
bunx wrangler dev --env-file ../../.env.test.example --local --ip 127.0.0.1 --port 8788 --inspector-port 9232
```

Terminal B:

```bash
cd apps/api
bun ./tests/generate-test-env.ts
bunx wrangler dev --env-file ./.env.test --local --ip 127.0.0.1 --port 8787 --inspector-port 9230
```

Terminal C:

```bash
cd apps/api
bun test
```
