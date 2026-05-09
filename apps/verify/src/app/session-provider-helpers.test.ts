/**
 * @vitest-environment jsdom
 */
import { expect, test, vi } from "vitest";
import { getWebDeviceId } from "./session-provider-helpers";

test("getWebDeviceId is stable for the page lifecycle without persistent storage", () => {
	const localStorageSetItem = vi.fn();
	Object.defineProperty(window, "localStorage", {
		configurable: true,
		value: {
			getItem: vi.fn(),
			setItem: localStorageSetItem,
		},
	});

	const first = getWebDeviceId();
	const second = getWebDeviceId();

	expect(first).toMatch(/^web-/);
	expect(second).toBe(first);
	expect(localStorageSetItem).not.toHaveBeenCalled();
});
