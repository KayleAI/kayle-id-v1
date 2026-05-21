export const MIN_APP_VERSION = process.env.MIN_APP_VERSION ?? "";

export function isAppVersionAtLeast(actual: string, minimum: string): boolean {
	if (!(actual && minimum)) {
		return true;
	}

	const actualVersion = parseSemver(actual);
	const minimumVersion = parseSemver(minimum);
	if (!(actualVersion && minimumVersion)) {
		return true;
	}

	for (let index = 0; index < 3; index += 1) {
		if ((actualVersion[index] ?? 0) > (minimumVersion[index] ?? 0)) {
			return true;
		}
		if ((actualVersion[index] ?? 0) < (minimumVersion[index] ?? 0)) {
			return false;
		}
	}

	return true;
}

function parseSemver(value: string): [number, number, number] | null {
	const parts = value.split(".").map((part) => Number.parseInt(part, 10));
	if (parts.some((part) => Number.isNaN(part))) {
		return null;
	}

	return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}
