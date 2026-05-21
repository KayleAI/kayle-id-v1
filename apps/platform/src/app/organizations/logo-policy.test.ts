import { describe, expect, test } from "vitest";
import {
	getOrganizationLogoFileError,
	ORGANIZATION_LOGO_ACCEPT,
} from "./logo-policy";

describe("organization logo policy", () => {
	test("matches the API logo content-type allowlist", () => {
		expect(ORGANIZATION_LOGO_ACCEPT).toBe(
			"image/png,image/jpeg,image/webp,image/gif",
		);
		expect(
			getOrganizationLogoFileError(
				new File(["logo"], "logo.png", {
					type: "image/png",
				}),
			),
		).toBeNull();
		expect(
			getOrganizationLogoFileError(
				new File(["logo"], "logo.jpg", {
					type: "image/jpeg",
				}),
			),
		).toBeNull();
		expect(
			getOrganizationLogoFileError(
				new File(["logo"], "logo.webp", {
					type: "image/webp",
				}),
			),
		).toBeNull();
		expect(
			getOrganizationLogoFileError(
				new File(["logo"], "logo.gif", {
					type: "image/gif",
				}),
			),
		).toBeNull();
	});

	test("rejects unsupported image content types before upload", () => {
		expect(
			getOrganizationLogoFileError(
				new File(["logo"], "logo.svg", {
					type: "image/svg+xml",
				}),
			),
		).toBe("Please select a PNG, JPEG, GIF, or WebP image.");
	});

	test("rejects files larger than one megabyte", () => {
		expect(
			getOrganizationLogoFileError(
				new File([new Uint8Array(1024 * 1024 + 1)], "logo.png", {
					type: "image/png",
				}),
			),
		).toBe("Logo must be 1 MB or smaller.");
	});
});
