import { expect, test } from "vitest";
import {
	getEndpointLabelsInput,
	getSuccessfulDeliveryFraction,
	parseEndpointLabels,
} from "./utils";

test("parses endpoint label input with trimming and case-insensitive dedupe", () => {
	expect(parseEndpointLabels(" demo, Demo, ops ,, identity ")).toEqual([
		"demo",
		"ops",
		"identity",
	]);
});

test("formats endpoint labels for editing", () => {
	expect(getEndpointLabelsInput(["demo", "run:123"])).toBe("demo, run:123");
});

test("formats successful event deliveries as a fraction", () => {
	expect(
		getSuccessfulDeliveryFraction([
			{ status: "succeeded" },
			{ status: "failed" },
			{ status: "pending" },
			{ status: "succeeded" },
		]),
	).toBe("2/4");
});

test("formats empty successful event deliveries as zero of zero", () => {
	expect(getSuccessfulDeliveryFraction([])).toBe("0/0");
});
