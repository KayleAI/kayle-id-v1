import * as schema from "@kayle-id/trust-store/schema";
import { drizzle } from "drizzle-orm/d1";

/**
 * Drizzle ORM client.
 *
 * @see https://orm.drizzle.team/docs
 */
const getClient = (env: { TRUST_STORE: D1Database }) => {
	return drizzle(env.TRUST_STORE, {
		schema,
	});
};

export { getClient };
