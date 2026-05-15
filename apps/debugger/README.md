# Kayle ID Debugger

Internal contributor tool for exercising the biometric verifier
pipeline end-to-end against locally-recorded webcam video. Records
WebM via `MediaRecorder`, posts to the verifier worker, renders the
returned scores plus a MediaPipe FaceMesh overlay on the source
video.

> **Not deployed.** This app has no `wrangler.jsonc` and is excluded
> from every production build. The repo-root `.env` provides the
> verifier URL + shared secret used by the Vite dev server proxy;
> nothing is bundled into the browser.

## Running locally

```sh
bun --filter ./apps/debugger dev
```

Required in repo-root `.env`:

```
BIOMETRIC_VERIFIER_DEV_URL=https://kayle-id-biometric-verifier-bench.<your-subdomain>.workers.dev
BIOMETRIC_VERIFIER_SECRET=<bench-env-secret>
```

The verifier `bench` env exposes richer per-step timing in the
response body (`_perfTrace`) which the debug UI surfaces. Use the
`bench` Worker — not production — for any iterative testing.
