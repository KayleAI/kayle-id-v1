import { describe, expect, it } from "bun:test";
import { buildSql, parseRange } from "./cost-analytics";

describe("parseRange", () => {
	it("defaults to a 30-day window when from/to are absent", () => {
		const result = parseRange({});
		if ("error" in result) {
			throw new Error(`expected range, got error: ${result.error}`);
		}
		const spanDays = (result.to.getTime() - result.from.getTime()) / 86_400_000;
		expect(spanDays).toBeCloseTo(30, 0);
	});

	it("rejects from >= to", () => {
		const result = parseRange({
			from: "2025-05-14T00:00:00Z",
			to: "2025-05-01T00:00:00Z",
		});
		expect("error" in result).toBe(true);
	});

	it("rejects ranges over 90 days", () => {
		const result = parseRange({
			from: "2025-01-01T00:00:00Z",
			to: "2025-06-01T00:00:00Z",
		});
		expect("error" in result).toBe(true);
	});

	it("accepts a valid 7-day window", () => {
		const result = parseRange({
			from: "2025-05-01T00:00:00Z",
			to: "2025-05-08T00:00:00Z",
		});
		if ("error" in result) {
			throw new Error("unexpected error");
		}
		expect(result.from.toISOString()).toBe("2025-05-01T00:00:00.000Z");
		expect(result.to.toISOString()).toBe("2025-05-08T00:00:00.000Z");
	});

	it("rejects unparseable dates", () => {
		const result = parseRange({ from: "not-a-date", to: "still-not" });
		expect("error" in result).toBe(true);
	});
});

describe("buildSql", () => {
	const from = new Date("2025-05-01T00:00:00Z");
	const to = new Date("2025-05-08T00:00:00Z");

	it("groups by feature using blob1", () => {
		const sql = buildSql({ groupBy: "feature", from, to });
		expect(sql).toContain("SELECT blob1 AS group_key");
		expect(sql).toContain("GROUP BY blob1");
		expect(sql).toContain("FROM KAYLE_ID_ANALYTICS");
	});

	it("groups by resource using blob2", () => {
		const sql = buildSql({ groupBy: "resource", from, to });
		expect(sql).toContain("SELECT blob2 AS group_key");
	});

	it("groups by day using toDate(timestamp)", () => {
		const sql = buildSql({ groupBy: "day", from, to });
		expect(sql).toContain("SELECT toDate(timestamp) AS group_key");
	});

	it("groups by org using index1", () => {
		const sql = buildSql({ groupBy: "org", from, to });
		expect(sql).toContain("SELECT index1 AS group_key");
	});

	it("formats timestamps as ClickHouse-compatible UTC", () => {
		const sql = buildSql({ groupBy: "feature", from, to });
		expect(sql).toContain("'2025-05-01 00:00:00'");
		expect(sql).toContain("'2025-05-08 00:00:00'");
	});

	it("orders by cost_usd descending and limits to 1000 rows", () => {
		const sql = buildSql({ groupBy: "feature", from, to });
		expect(sql).toContain("ORDER BY cost_usd DESC");
		expect(sql).toContain("LIMIT 1000");
	});
});
