import { generateRandomString as generateSecureRandomString } from "@kayle-id/config/random";

export function generateRandomString(length: number): string {
	return generateSecureRandomString(length);
}

/**
 * Generate a random unique ID.
 *
 * @returns {string} The generated ID.
 */
export function generateId({
	type,
	length = 64,
}: {
	/**
	 * The type of ID to generate. For example, vs, whk, va, etc
	 */
	type: string;
	/**
	 * The length of the ID to generate. For example, 32 for a 32 character ID.
	 */
	length?: number;
}): string {
	return `${type}_${generateRandomString(length)}`;
}
