import pkg from "../../../../package.json" with { type: "json" };

export const APP_VERSION: string = pkg.version;

// Deploy-env tag for telemetry; distinct from NODE_ENV (runtime mode).
const deployEnv = process.env.KAYLE_ENVIRONMENT;
const nodeEnv = process.env.NODE_ENV;
export const APP_ENVIRONMENT: string =
	typeof deployEnv === "string" && deployEnv.length > 0
		? deployEnv
		: typeof nodeEnv === "string" && nodeEnv.length > 0
			? nodeEnv
			: "unknown";
