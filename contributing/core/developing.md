# Developing

This page covers the full local development setup — what to install, how to seed the stack, and how to launch every service. For a one-paragraph quick start, see the project [README](../../README.md).

## Local stack

| Component             | Path                  | URL                                                 |
| --------------------- | --------------------- | --------------------------------------------------- |
| API worker            | `apps/api`            | `http://127.0.0.1:8787`                             |
| Platform web app      | `apps/platform`       | `https://localhost:3000`                            |
| Verify web app        | `apps/verify`         | `http://localhost:2999`                             |
| Postgres              | `infra/postgres`      | `postgres://postgres:postgres@localhost:6432/kayle-id` |
| Redis (Upstash shim)  | `infra/redis`         | `http://localhost:8079` (token `a-super-secret-token`) |
| Biometric verifier    | `infra/biometric-verifier` | `http://127.0.0.1:8788`                        |
| iOS app               | `apps/ios`            | physical iPhone (no simulator)                      |

## 0. Prerequisites

Install before you start:

- Bun 1.3.6+
- Docker Desktop
- Xcode + Xcode Command Line Tools (only for iOS work)
- Swift toolchain (only for iOS work)
- Python 3
- CMake
- Cap'n Proto compiler (`capnpc`)
- Git

### Clone and install

```bash
git clone https://github.com/KayleAI/kayle-id.git ~/kayle-id
cd ~/kayle-id
bun install
```

### Build `capnproto-swift` (iOS only)

The iOS project and the Cap'n Proto generation scripts both assume a local checkout at `~/capnproto-swift`:

```bash
git clone https://github.com/arsenstorm/capnproto-swift.git ~/capnproto-swift
git -C ~/capnproto-swift submodule update --init --recursive
bash ~/capnproto-swift/scripts/build-xcframework.sh
```

`apps/ios/Kayle ID.xcodeproj` hardcodes `~/capnproto-swift` and so does `scripts/generate-capnp.sh` (`CAPNPROTO_SWIFT_PATH` defaults to `~/capnproto-swift`). If you keep that repo somewhere else, set `CAPNPROTO_SWIFT_PATH` for the script and repoint the local Swift package in Xcode.

### Generate Cap'n Proto outputs

Fresh clones may not have `packages/capnp/generated/`. If either of these is missing:

- `packages/capnp/generated/ts/verify.ts`
- `packages/capnp/generated/c/verify.capnp.c++`

run:

```bash
CAPNPROTO_SWIFT_PATH=~/capnproto-swift bash ./scripts/generate-capnp.sh
```

The C++ outputs are required for the iOS app; the TypeScript outputs are required for the API and verify Workers.

## 1. Environment variables

The local stack reads everything from a single `.env` at the repo root. Don't hand-author it.

**Outside contributors — `bun run env:setup`.**

```bash
bun run env:setup
```

This writes a working `.env` with:

- random hex for `AUTH_SECRET`, `KAYLE_INTERNAL_TOKEN`, `BIOMETRIC_VERIFIER_SECRET`, `ORG_VERIFICATION_PEPPER`
- `REDIS_URL` / `REDIS_TOKEN` pinned to the local Upstash REST shim (`http://localhost:8079`, token `a-super-secret-token`)
- dummy `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `EMAIL_FROM_ADDRESS` set to `Kayle ID <auth@kayle.id>`

The dev API logs the magic OTP and email body instead of calling Google or Resend, so the dummy credentials are sufficient for the full sign-in flow. The script refuses to overwrite an existing `.env` — delete it first if you want a fresh bootstrap.

**Maintainers — `bun run env:pull`.**

After installing the [Infisical CLI](https://infisical.com/docs/cli/overview) and running `infisical login` once:

```bash
bun run env:pull           # pulls the dev environment from Infisical
bun run env:pull -- staging  # pull a different env if needed
```

This rewrites the repo-root `.env` with the real shared dev secrets. The Infisical workspace is pinned in `.infisical.json`.

### Optional dev-only overrides

Add these to `.env` only if you need them:

- `KAYLE_DEV_API_BASE_URL=http://<reachable-host>:8787` — required for the physical iPhone build. Don't use `localhost`; use an IP or hostname reachable from the phone (a Tailscale IP works well).
- `KAYLE_DEMO_API_KEY` / `KAYLE_DEMO_ORG_SLUG` — required only if you want `https://localhost:3000/demo` to create real sessions against the local API. `KAYLE_DEMO_ORG_SLUG` defaults to `"kayle"`.
- Real `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — only if you want to test real Google sign-in locally.

`REDIS_URL` and `REDIS_TOKEN` are not optional — Better Auth's secondary storage is Redis-backed, so the env schema enforces them. `bun run env:setup` writes the local-shim defaults and `bun run redis:start` brings the matching container up.

### Optional `apps/verify/.env`

The verify app already defaults to the local API host. If you need to override:

```dotenv
PUBLIC_API_HOST=127.0.0.1:8787
PUBLIC_API_PROTOCOL=ws
```

### Test-only `apps/api/.env.test`

Don't hand-author this file. Generate it when you need API tests:

```bash
cd apps/api
bun ./tests/generate-test-env.ts
```

That command creates `apps/api/.env.test` from `/.env.test.example` and injects the generated trust bundle JSON used by the API test worker.

## 2. Launch Postgres + Redis via Docker

From the repo root:

```bash
bun run services:start   # docker compose up -d for both Postgres and Redis
```

Or bring them up individually:

```bash
bun run db:start         # Postgres (infra/postgres/compose.yml)
bun run redis:start      # Redis + Upstash REST shim (infra/redis/compose.yml)
```

Companion commands:

```bash
bun run db:logs       bun run redis:logs
bun run db:stop       bun run redis:stop
bun run db:clean      bun run redis:clean
bun run services:stop # stop both stacks
```

Notes:

- Postgres listens on host port `6432`. The Compose file is `infra/postgres/compose.yml`.
- Redis itself is internal to the Compose network; the Upstash-compatible REST shim is exposed on `http://localhost:8079` with the pinned token `a-super-secret-token` so every contributor and the CI test job hit the same URL.
- `database/kayle-id/seed.sql` is currently empty, so there is no separate app-data seed to apply here beyond migrations.

## 3. Seed the local dataset

The meaningful local seed step is the ICAO PKD trust-store import, which populates the local D1 trust store used by document authenticity checks.

Download the ICAO PKD LDIF files from the [ICAO website](https://pkddownload.icao.int/downloads), then run:

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

That starts the API worker, biometric-verifier worker, platform app, and verify app. Local URLs:

- API health: `http://127.0.0.1:8787/`
- API docs: `http://127.0.0.1:8787/reference`
- Biometric verifier health: `http://127.0.0.1:8788/health`
- Platform: `https://localhost:3000`
- Verify: `http://localhost:2999`

Notes:

- The platform app uses a local HTTPS cert via Vite Basic SSL. On first launch, your browser may warn about the self-signed certificate.
- The biometric verifier's first boot can take longer because Wrangler builds its container image and downloads the OpenCV ONNX models.
- If you only want one app at a time, use the workspace-level scripts (`cd apps/api && bun run dev`, etc.).

### Optional: create a demo API key through the platform UI

If you want the local `/demo` route to create sessions:

1. Open `https://localhost:3000/sign-in`.
2. Submit your email.
3. Watch the API logs for the `auth.magic_otp.generated` event.
4. Complete sign-in and create or select an organization.
5. Create an API key in the platform UI.
6. Put that key into `apps/platform/.env` as `KAYLE_DEMO_API_KEY=...`.
7. Restart the platform app.

## 5. Launch the iOS app

### Current constraints

The current iOS flow assumes:

- a physical iPhone, not the simulator
- camera access
- NFC access
- working Apple code signing
- a reachable `KAYLE_DEV_API_BASE_URL`

The app defaults to production if `KAYLE_DEV_API_BASE_URL` is missing, so don't skip that variable if you want local end-to-end behavior.

### One-time Xcode signing setup

Open the project once in Xcode:

```bash
open "apps/ios/Kayle ID.xcodeproj"
```

Then:

1. Select the `Kayle ID` target.
2. Set your own Apple development team under Signing.
3. If automatic signing fails, change the bundle identifier from `kayle.id` to something unique for your account.

The project hardcodes a development team and bundle identifier, so another machine usually needs this manual setup first.

### Ensure the local backend is running

Keep these running first:

- Postgres + Redis (via `bun run services:start`)
- the local trust-store seed has been applied
- `bun run dev`

### Use a phone-reachable API base URL

Set `KAYLE_DEV_API_BASE_URL` in the root `.env` to a URL the phone can reach:

```dotenv
KAYLE_DEV_API_BASE_URL=http://192.168.x.x:8787
```

or a Tailscale IP / hostname.

### Run on a connected device

```bash
bash ./apps/ios/scripts/run-on-connected-device.sh --api-base-url http://<reachable-host>:8787
```

If multiple connected phones are visible:

```bash
bash ./apps/ios/scripts/run-on-connected-device.sh --device "<udid-or-device-name>" --api-base-url http://<reachable-host>:8787
```

What this script does:

- resolves a connected physical iPhone destination
- builds the app with `xcodebuild`
- installs it with `xcrun devicectl`
- launches it with `KAYLE_DEV_API_BASE_URL` injected into the process environment

### If the build fails

Check, in order:

- `packages/capnp/generated/c/verify.capnp.c++` exists
- `~/capnproto-swift` exists and has been built with `scripts/build-xcframework.sh`
- Xcode signing is configured for your Apple account
- the connected device is trusted and visible to Xcode
