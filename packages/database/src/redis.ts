import { env } from "@kayle-id/config/env";
import { Redis } from "@upstash/redis";

// `automaticDeserialization: false` keeps `.get()` returning the raw stored
// string. Better Auth's secondary-storage contract sets/reads opaque strings
// (it does its own `JSON.parse` on retrieval), so auto-parsing here would
// hand back an object and break session decode.
const redis = new Redis({
	url: env.REDIS_URL,
	token: env.REDIS_TOKEN,
	automaticDeserialization: false,
});

export { redis };
