Privacy-first identity verification.

# Kayle ID

Kayle ID is a project engineered by [Kayle](https://kayle.ai) to give people control over their own identity.

This open-source repository contains the official implementation of the Kayle ID system.

## Local Development

Quick start:

```bash
bun install
bun run env:setup       # writes .env with random local secrets + dummy third-party creds
bun run services:start  # bring up local Postgres + Redis (Upstash REST shim)
bun run db:setup
bun run dev
```

The bootstrap fills in random hex for `AUTH_SECRET`, `KAYLE_INTERNAL_TOKEN`, `FACE_MATCHER_SECRET`, and `ORG_VERIFICATION_PEPPER`; pins `REDIS_URL` / `REDIS_TOKEN` to the local Upstash REST shim; and writes dummy values for Google OAuth / Resend. The dev API falls back to logging magic OTPs and email bodies, so contributors do not need any third-party accounts to run the full stack.

`bun run services:start` is a convenience wrapper around `db:start` + `redis:start`. Both Docker Compose stacks live under [`infra/`](infra/) and can also be controlled individually (`db:logs`, `redis:stop`, `db:clean`, etc.).

Maintainers with Infisical access can pull the shared dev secrets instead:

```bash
infisical login          # once per machine
bun run env:pull         # writes the repo-root .env from Infisical
```

## Data Processing

Kayle ID processes end-user identity data to perform document checks.

We minimise what we store, encrypt all verification results, and never use this data for any purpose other than verification. You can read more about our data processing in our [privacy policy](https://kayle.id/privacy).

## License

This project is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for details.

<sub>Copyright © 2025 Kayle Inc. All rights reserved.</sub>
