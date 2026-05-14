import pkg from "../../../../package.json" with { type: "json" };

export const APP_VERSION: string = pkg.version;
export const APP_ENVIRONMENT: string =
	typeof process.env.NODE_ENV === "string" && process.env.NODE_ENV.length > 0
		? process.env.NODE_ENV
		: "unknown";
