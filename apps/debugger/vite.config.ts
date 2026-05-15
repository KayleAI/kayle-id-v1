import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import viteTsConfigPaths from "vite-tsconfig-paths";

// Contributor debug tool. Runs against a local `wrangler dev` of the
// biometric verifier (default port 8788) and proxies `/verifier/*` to it,
// injecting the shared secret from the repo-root `.env` so the secret
// never enters the browser bundle. This is dev-only — there is no deploy
// target for this app.
const DEFAULT_VERIFIER_TARGET = "http://127.0.0.1:8788";

export default defineConfig(({ mode }) => {
	const repoRoot = new URL("../../", import.meta.url).pathname;
	const env = loadEnv(mode, repoRoot, "");
	const verifierSecret = env.BIOMETRIC_VERIFIER_SECRET ?? "";
	const verifierTarget =
		env.BIOMETRIC_VERIFIER_DEV_URL ?? DEFAULT_VERIFIER_TARGET;

	return {
		plugins: [
			// Router plugin MUST come before viteReact — it generates
			// routeTree.gen.ts from src/routes/ and the React plugin needs
			// the generated file present when it processes the entry.
			tanstackRouter({ target: "react", autoCodeSplitting: true }),
			viteReact(),
			tailwindcss(),
			viteTsConfigPaths(),
		],
		server: {
			port: 5859,
			strictPort: false,
			proxy: {
				"/verifier": {
					target: verifierTarget,
					changeOrigin: true,
					rewrite: (path) => path.replace(/^\/verifier/, ""),
					configure: (proxy) => {
						proxy.on("proxyReq", (proxyReq) => {
							if (verifierSecret.length > 0) {
								proxyReq.setHeader("Authorization", `Bearer ${verifierSecret}`);
							}
						});
					},
				},
			},
		},
	};
});
