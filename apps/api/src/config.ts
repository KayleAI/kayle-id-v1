import pkg from "../../../package.json" with { type: "json" };

// `environment` is the deploy-env tag for telemetry; NODE_ENV stays
// the runtime-mode flag (staging pins it to "production").
const deployEnv = process.env.KAYLE_ENVIRONMENT;

export const config = {
	version: pkg.version,
	environment:
		typeof deployEnv === "string" && deployEnv.length > 0
			? deployEnv
			: process.env.NODE_ENV,
	port: 8787,
};
