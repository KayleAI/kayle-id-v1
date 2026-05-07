import { describe, expect, test } from "bun:test";
import { mapMrzDocumentTypeToEnum } from "@/internal/org-verification/document-type";

describe("mapMrzDocumentTypeToEnum", () => {
	test("maps the TD3 passport code to passport", () => {
		expect(mapMrzDocumentTypeToEnum("P")).toBe("passport");
		expect(mapMrzDocumentTypeToEnum("P<")).toBe("passport");
		expect(mapMrzDocumentTypeToEnum(" p ")).toBe("passport");
	});

	test("maps the residence permit codes to residence_permit", () => {
		expect(mapMrzDocumentTypeToEnum("IR")).toBe("residence_permit");
		expect(mapMrzDocumentTypeToEnum("AR")).toBe("residence_permit");
	});

	test("maps national ID codes to national_id", () => {
		expect(mapMrzDocumentTypeToEnum("ID")).toBe("national_id");
		expect(mapMrzDocumentTypeToEnum("I")).toBe("national_id");
		expect(mapMrzDocumentTypeToEnum("AC")).toBe("national_id");
		expect(mapMrzDocumentTypeToEnum("C")).toBe("national_id");
	});

	test("falls through to other for unknown prefixes", () => {
		expect(mapMrzDocumentTypeToEnum("X")).toBe("other");
		expect(mapMrzDocumentTypeToEnum("")).toBe("other");
	});
});
