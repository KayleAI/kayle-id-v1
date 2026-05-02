import { mock } from "bun:test";

type FetchImplementation = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

export function createMockFetch(
	implementation: FetchImplementation,
): typeof fetch {
	return Object.assign(mock(implementation), {
		preconnect: globalThis.fetch.preconnect,
	});
}
