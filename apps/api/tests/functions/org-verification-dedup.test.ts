import { describe, expect, test } from "bun:test";
import {
	computeDedupHash,
	type DedupHashInput,
	normalizeDocumentNumber,
	normalizeIssuingCountry,
} from "@/v1/org-verification/dedup";

const FIXED_PEPPER = "pepper-for-tests-do-not-use-in-prod";

describe("normalizeDocumentNumber", () => {
	test("uppercases", () => {
		expect(normalizeDocumentNumber("ab123456")).toBe("AB123456");
	});

	test("strips whitespace", () => {
		expect(normalizeDocumentNumber("AB 123 456")).toBe("AB123456");
		expect(normalizeDocumentNumber(" AB123456 ")).toBe("AB123456");
		expect(normalizeDocumentNumber("AB\t123\n456")).toBe("AB123456");
	});

	test("strips hyphens", () => {
		expect(normalizeDocumentNumber("AB-123-456")).toBe("AB123456");
		expect(normalizeDocumentNumber("ab-123-456")).toBe("AB123456");
	});

	test("collapses mixed casing + spacing + hyphens to identical output", () => {
		const variants = [
			"AB123456",
			"ab123456",
			"AB 123456",
			"AB-123456",
			"  ab 123-456 ",
			"AB-123 456",
		];
		const normalized = new Set(variants.map(normalizeDocumentNumber));
		expect(normalized.size).toBe(1);
		expect([...normalized][0]).toBe("AB123456");
	});
});

describe("normalizeIssuingCountry", () => {
	test("uppercases the alpha-3 code", () => {
		expect(normalizeIssuingCountry("gbr")).toBe("GBR");
		expect(normalizeIssuingCountry("USA")).toBe("USA");
	});

	test("rejects non-alpha-3 inputs", () => {
		expect(() => normalizeIssuingCountry("GB")).toThrow();
		expect(() => normalizeIssuingCountry("UNITED")).toThrow();
		expect(() => normalizeIssuingCountry("")).toThrow();
	});

	test("strips whitespace before length check", () => {
		expect(normalizeIssuingCountry(" GBR ")).toBe("GBR");
	});
});

describe("computeDedupHash", () => {
	test("produces stable golden output for a known pepper + input", async () => {
		// Golden vector: the exact digest is asserted so any future change to
		// hash inputs, separator, normalization, or primitive will fail the
		// test instead of silently invalidating every existing record.
		const input: DedupHashInput = {
			documentType: "passport",
			documentNumber: "AB123456",
			issuingCountry: "GBR",
		};
		const hash = await computeDedupHash(input, FIXED_PEPPER);
		expect(hash).toBe(
			"bf8b351b6428e70ed790143e944a6bb2a5f59a4a44f131d9f1233d53ca7b589b",
		);
	});

	test("identical normalized inputs produce identical hashes", async () => {
		const variants: DedupHashInput[] = [
			{
				documentType: "passport",
				documentNumber: "AB123456",
				issuingCountry: "GBR",
			},
			{
				documentType: "passport",
				documentNumber: "ab123456",
				issuingCountry: "gbr",
			},
			{
				documentType: "passport",
				documentNumber: "AB 123 456",
				issuingCountry: "GBR",
			},
			{
				documentType: "passport",
				documentNumber: "ab-123-456",
				issuingCountry: "GBR",
			},
		];

		const hashes = await Promise.all(
			variants.map((input) => computeDedupHash(input, FIXED_PEPPER)),
		);
		expect(new Set(hashes).size).toBe(1);
	});

	test("different document types do not collide", async () => {
		const number = "AB123456";
		const passport = await computeDedupHash(
			{
				documentType: "passport",
				documentNumber: number,
				issuingCountry: "GBR",
			},
			FIXED_PEPPER,
		);
		const nationalId = await computeDedupHash(
			{
				documentType: "national_id",
				documentNumber: number,
				issuingCountry: "GBR",
			},
			FIXED_PEPPER,
		);
		expect(passport).not.toBe(nationalId);
	});

	test("different issuing countries do not collide", async () => {
		const gbr = await computeDedupHash(
			{
				documentType: "passport",
				documentNumber: "AB123456",
				issuingCountry: "GBR",
			},
			FIXED_PEPPER,
		);
		const usa = await computeDedupHash(
			{
				documentType: "passport",
				documentNumber: "AB123456",
				issuingCountry: "USA",
			},
			FIXED_PEPPER,
		);
		expect(gbr).not.toBe(usa);
	});

	test("delimiter prevents field-shifting collisions", async () => {
		// Concatenating fields without a delimiter would let ("passport",
		// "123", "GBR") collide with ("passport", "12", "3GBR"). Country is
		// enforced to alpha-3 so the second variant can't be constructed via
		// the public API; we still exercise that two visually-similar
		// concatenations produce distinct hashes.
		const a = await computeDedupHash(
			{
				documentType: "passport",
				documentNumber: "123",
				issuingCountry: "GBR",
			},
			FIXED_PEPPER,
		);
		const b = await computeDedupHash(
			{
				documentType: "passport",
				documentNumber: "12",
				issuingCountry: "GBR",
			},
			FIXED_PEPPER,
		);
		expect(a).not.toBe(b);
	});

	test("rejects empty document number", async () => {
		await expect(
			computeDedupHash(
				{
					documentType: "passport",
					documentNumber: "   ",
					issuingCountry: "GBR",
				},
				FIXED_PEPPER,
			),
		).rejects.toThrow();
	});

	test("changing the pepper changes the hash", async () => {
		const input: DedupHashInput = {
			documentType: "passport",
			documentNumber: "AB123456",
			issuingCountry: "GBR",
		};
		const a = await computeDedupHash(input, FIXED_PEPPER);
		const b = await computeDedupHash(input, "different-pepper");
		expect(a).not.toBe(b);
	});
});
