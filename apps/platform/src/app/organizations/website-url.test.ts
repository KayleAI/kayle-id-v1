import { describe, expect, test } from "vitest";
import {
	parsePublicPrivacyPolicyUrl,
	parsePublicTermsOfServiceUrl,
	parsePublicWebsiteUrl,
} from "./website-url";

describe("parsePublicWebsiteUrl", () => {
	test("accepts http and https URLs", () => {
		expect(parsePublicWebsiteUrl("https://example.com/path")).toMatchObject({
			href: "https://example.com/path",
			label: "https://example.com/path",
		});
		expect(parsePublicWebsiteUrl("http://example.com/")).toMatchObject({
			href: "http://example.com/",
			label: "http://example.com/",
		});
	});

	test("rejects browser-executable and non-web schemes", () => {
		expect(parsePublicWebsiteUrl("javascript:alert(1)")).toBeNull();
		expect(
			parsePublicWebsiteUrl("data:text/html,<script>x</script>"),
		).toBeNull();
		expect(parsePublicWebsiteUrl("mailto:help@example.com")).toBeNull();
	});

	test("rejects URLs with embedded credentials", () => {
		expect(parsePublicWebsiteUrl("https://user:pw@example.com/")).toBeNull();
	});

	test("rejects malformed or empty values", () => {
		expect(parsePublicWebsiteUrl("example.com")).toBeNull();
		expect(parsePublicWebsiteUrl("")).toBeNull();
		expect(parsePublicWebsiteUrl(null)).toBeNull();
	});
});

describe("parsePublicPrivacyPolicyUrl", () => {
	test("accepts http and https URLs", () => {
		expect(
			parsePublicPrivacyPolicyUrl("https://example.com/privacy"),
		).toMatchObject({ href: "https://example.com/privacy" });
	});

	test("rejects unsafe schemes and credentials", () => {
		expect(parsePublicPrivacyPolicyUrl("javascript:alert(1)")).toBeNull();
		expect(
			parsePublicPrivacyPolicyUrl("https://user:pw@example.com/privacy"),
		).toBeNull();
		expect(parsePublicPrivacyPolicyUrl("")).toBeNull();
	});
});

describe("parsePublicTermsOfServiceUrl", () => {
	test("accepts http and https URLs", () => {
		expect(
			parsePublicTermsOfServiceUrl("https://example.com/terms"),
		).toMatchObject({ href: "https://example.com/terms" });
	});

	test("rejects unsafe schemes and credentials", () => {
		expect(parsePublicTermsOfServiceUrl("ftp://example.com/terms")).toBeNull();
		expect(
			parsePublicTermsOfServiceUrl("https://user:pw@example.com/terms"),
		).toBeNull();
		expect(parsePublicTermsOfServiceUrl(null)).toBeNull();
	});
});
