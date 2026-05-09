import { describe, expect, test, vi } from "vitest";
import { mapDocumentTypeCode } from "./webhook-receiver";

vi.mock("cloudflare:workers", () => ({ env: {} }));

describe("org verification webhook document type mapping", () => {
	test("mirrors the API document type enum mapping", () => {
		expect(mapDocumentTypeCode("P")).toBe("passport");
		expect(mapDocumentTypeCode("IR")).toBe("residence_permit");
		expect(mapDocumentTypeCode("AR")).toBe("residence_permit");
		expect(mapDocumentTypeCode("I")).toBe("national_id");
		expect(mapDocumentTypeCode("A")).toBe("national_id");
		expect(mapDocumentTypeCode("C")).toBe("national_id");
		expect(mapDocumentTypeCode("V")).toBe("other");
		expect(mapDocumentTypeCode(null)).toBe("other");
	});
});
