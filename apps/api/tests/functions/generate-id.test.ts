import { expect, test } from "bun:test";
import { generateId } from "@/utils/generate-id";

const ID_REGEX = /^vs_[A-Za-z0-9]{64}$/;

test("generateId", () => {
	const id = generateId({
		type: "vs",
	});
	expect(id).toBeString();
	expect(id).toMatch(ID_REGEX);
});
