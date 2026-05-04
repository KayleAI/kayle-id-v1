import { pool } from "@kayle-id/database/raw";
import { relations } from "@kayle-id/database/schema";
import { drizzle } from "drizzle-orm/node-postgres";

/**
 * Drizzle ORM client.
 *
 * @see https://orm.drizzle.team/docs
 */
const db = drizzle({
	client: pool,
	relations,
});

export { db };
