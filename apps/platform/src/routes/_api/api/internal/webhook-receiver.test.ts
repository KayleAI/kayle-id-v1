import { describe, expect, test, vi } from "vitest";
import { mapDocumentTypeCode } from "./webhook-receiver";

// `webhook-receiver.ts` imports `@/config/env`, which validates required
// platform secrets at module load time. `mapDocumentTypeCode` is pure, so
// we stub the module to keep CI green without seeding the secrets.
// (vi.mock is hoisted above the imports above.)
vi.mock("@/config/env", () => ({ env: {} }));

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
