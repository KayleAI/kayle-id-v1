import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

// DrizzleKit intentionally uses the DATABASE_URL instead of Hyperdrive
dotenv.config({
	path:
		process.env.NODE_ENV === "production"
			? new URL("../../.env.production", import.meta.url).pathname
			: new URL("../../.env", import.meta.url).pathname,
	debug: false,
});

export default defineConfig({
	schema: ["./src/schema/*.ts"],
	out: "../../database/kayle-id/migrations",
	dialect: "postgresql",
	dbCredentials: {
		url: process.env.DATABASE_URL as string,
	},
	schemaFilter: ["public"],
});
