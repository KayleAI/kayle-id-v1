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

There are three env files that matter for local development:

- `/.env`: shared by the API, database tooling, face matcher, and some shared config
- `apps/platform/.env`: platform-specific env vars
- `apps/api/.env.test`: generated test-only env file

`apps/verify/.env` is optional. The verify app already defaults to the local API in development.

### Root `.env`

Create `~/kayle-id/.env` (or wherever you cloned the repo to) with:

```dotenv
DATABASE_URL=postgres://postgres:postgres@localhost:6432/kayle-id

KAYLE_INTERNAL_TOKEN=replace-with-one-random-shared-token
AUTH_SECRET=replace-with-one-random-secret

# Recommended for the current local platform auth flow.
# The checked-in .env.example still shows https://localhost:8787,
# but the platform app proxies auth through https://localhost:3000/api/auth.
PUBLIC_AUTH_URL=https://localhost:3000

# Required for the physical iPhone build if you want the app to use your local API.
# Do not use localhost here. Use an IP or hostname reachable from the phone.
# Tailscale IP is a good choice.
KAYLE_DEV_API_BASE_URL=http://<reachable-host>:8787

# Optional but recommended to keep API -> face matcher requests authenticated.
FACE_MATCHER_SECRET=replace-with-one-random-secret

# Optional unless you wire Redis-backed behavior.
REDIS_URL=
REDIS_TOKEN=

# Required by the current env schema, even if you are not using them locally.
# Dummy non-empty values are enough for local boot.
GOOGLE_CLIENT_ID=dummy-google-client-id
GOOGLE_CLIENT_SECRET=dummy-google-client-secret
EMAIL_FROM_ADDRESS="Kayle ID <auth@kayle.id>"
```

Important notes:

- `KAYLE_INTERNAL_TOKEN` must match between root `.env` and `apps/platform/.env`.
- `KAYLE_DEV_API_BASE_URL` must be reachable from the physical iPhone. `http://127.0.0.1:8787` will not work on the phone.
- In development, magic OTP sign-in is logged by the API instead of being emailed, so the Cloudflare Email Service binding is unused locally and `EMAIL_FROM_ADDRESS` only needs to be a valid-looking address.
- If you actually want Google sign-in to work locally, replace the dummy Google values with real OAuth credentials.

### `apps/platform/.env`

Create `~/kayle-id/apps/platform/.env` (or wherever you cloned the repo to) with:

```dotenv
KAYLE_INTERNAL_TOKEN=replace-with-the-same-value-from-root-env

# Optional, but required if you want the local /demo flow to create sessions.
KAYLE_DEMO_API_KEY=

# Optional. Defaults to "kayle" if omitted.
KAYLE_DEMO_ORG_SLUG=
```

Notes:

- `KAYLE_DEMO_API_KEY` is not required to boot the platform app.
- It is required if you want `https://localhost:3000/demo` to create real sessions against the local API.

### Optional `apps/verify/.env`

You can leave `apps/verify/.env` alone. The dev app already defaults to the local API host.

If you want to be explicit, use:

```dotenv
PUBLIC_API_HOST=127.0.0.1:8787
PUBLIC_API_PROTOCOL=ws
```

### Test-only `apps/api/.env.test`

Do not hand-author this file. Generate it when you need API tests:

```bash
cd apps/api
bun run test:setup
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
bun run test:setup
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
bun run test:dev
```

Terminal B:

```bash
cd apps/api
bun run test:setup
bun run test:dev
```

Terminal C:

```bash
cd apps/api
bun test
```
